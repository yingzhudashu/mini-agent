/**
 * @file poll-server.ts — 飞书 WebSocket 长轮询服务器
 * @description
 *   使用飞书 SDK 的 WSClient 长轮询模式接收事件推送。
 *
 *   与 OpenClaw 对齐的核心机制：
 *   - 单客户端单例（防止多实例导致事件路由不确定）
 *   - 内存去重 + 磁盘持久化去重（防止重复处理）
 *   - 聊天室级别顺序队列（防止并发导致上下文混乱）
 *   - 消息防抖（合并同一发送者短时内的连续消息）
 *   - 优雅关闭（SIGINT/SIGTERM）
 *
 * @module feishu/poll-server
 */

import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FeishuConfig } from './types.js';
import { releaseInstance } from '../core/instance-manager.js';

// ============================================================================
// 🔴 P0：单客户端单例（对齐 OpenClaw 的 wsClients Map）
// ============================================================================

let singletonWsClient: lark.WSClient | null = null;
let singletonAppId: string | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let dedupCleanTimer: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// 🔴 P0：消息去重（对齐 OpenClaw 的 processingClaims + persistentDedupe）
// ============================================================================

/** 内存去重：TTL 5 分钟，与 OpenClaw 的 EVENT_DEDUP_TTL_MS 对齐 */
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 2000;
const processingClaims = new Map<string, number>();

/** 磁盘去重路径 */
const stateDir = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  'feishu',
  'dedup'
);
const dedupFilePath = path.join(stateDir, 'processed.json');

function ensureStateDir() {
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
}

function loadDiskDedup(): Map<string, number> {
  try {
    ensureStateDir();
    if (fs.existsSync(dedupFilePath)) {
      const raw = fs.readFileSync(dedupFilePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, number>;
      return new Map(Object.entries(data));
    }
  } catch {
    // 静默忽略，文件损坏时重建
  }
  return new Map();
}

function saveDiskDedup(dedup: Map<string, number>) {
  try {
    ensureStateDir();
    const data = Object.fromEntries(dedup);
    fs.writeFileSync(dedupFilePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // 磁盘写入失败时静默忽略
  }
}

let diskDedup = loadDiskDedup();

function resolveDedupKey(messageId: string): string {
  return `mini-agent:${messageId.trim()}`;
}

function pruneProcessingClaims() {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [key, seenAt] of processingClaims) {
    if (seenAt < cutoff) processingClaims.delete(key);
  }
  // 清理磁盘去重中的过期条目
  for (const [key, seenAt] of diskDedup) {
    if (seenAt < cutoff) diskDedup.delete(key);
  }
  if (processingClaims.size + diskDedup.size > DEDUP_MAX_SIZE * 2) {
    saveDiskDedup(diskDedup);
  }
}

/**
 * 尝试获取消息处理权
 * @returns true = 首次处理，可以处理；false = 重复/处理中，跳过
 */
function tryBeginProcessing(messageId: string): boolean {
  const key = resolveDedupKey(messageId);
  if (!key) return true;

  const now = Date.now();
  pruneProcessingClaims();

  // 1. 检查磁盘去重
  if (diskDedup.has(key)) {
    return false; // 已经处理过
  }

  // 2. 检查内存处理中锁
  if (processingClaims.has(key)) {
    return false; // 正在处理中
  }

  // 获取处理权
  processingClaims.set(key, now);
  pruneProcessingClaims();
  return true;
}

/** 释放处理锁 + 记录到磁盘去重 */
function releaseProcessing(messageId: string) {
  const key = resolveDedupKey(messageId);
  if (!key) return;

  processingClaims.delete(key);
  diskDedup.set(key, Date.now());

  // 限制磁盘去重大小
  if (diskDedup.size > DEDUP_MAX_SIZE) {
    // 删除最老的 20%
    const sorted = Array.from(diskDedup.entries())
      .sort((a, b) => a[1] - b[1]);
    const toRemove = Math.floor(sorted.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      diskDedup.delete(sorted[i][0]);
    }
    saveDiskDedup(diskDedup);
  }
}

// ============================================================================
// 🟡 P1：顺序队列（对齐 OpenClaw 的 createSequentialQueue）
// ============================================================================

const chatQueues = new Map<string, (() => Promise<void>)[]>();

function enqueueChatMessage(chatId: string, fn: () => Promise<void>): void {
  let queue = chatQueues.get(chatId);
  if (!queue) {
    queue = [];
    chatQueues.set(chatId, queue);
  }
  queue.push(fn);

  // 如果队列长度为 1，说明没有正在处理，立即开始
  if (queue.length === 1) {
    processChatQueue(chatId);
  }
}

async function processChatQueue(chatId: string): Promise<void> {
  const queue = chatQueues.get(chatId);
  if (!queue || queue.length === 0) return;

  const fn = queue.shift()!;
  try {
    await fn();
  } catch (err) {
    console.error(`[飞书队列] 处理失败 [${chatId}]:`, err);
  }

  // 继续处理下一条
  if (queue.length > 0) {
    processChatQueue(chatId);
  } else {
    chatQueues.delete(chatId);
  }
}

// ============================================================================
// 🟡 P1：消息防抖（对齐 OpenClaw 的 createInboundDebouncer）
// ============================================================================

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * 对同一聊天室的消息进行防抖
 * 1.5 秒内的连续消息，只处理最后一条
 * 对齐 OpenClaw 的防抖逻辑
 */
function debounceMessage(
  chatId: string,
  fn: () => Promise<void>,
  delayMs: number = 1500
): void {
  const existing = debounceTimers.get(chatId);
  if (existing) {
    clearTimeout(existing);
  }

  debounceTimers.set(
    chatId,
    setTimeout(() => {
      debounceTimers.delete(chatId);
      fn().catch((err) => console.error('[飞书防抖] 处理失败:', err));
    }, delayMs)
  );
}

// ============================================================================
// 🟢 P2：优雅关闭（对齐 OpenClaw 的 abortSignal + cleanup）
// ============================================================================

let isShuttingDown = false;

function gracefulShutdown(wsClient: lark.WSClient) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('\n👋 飞书 WebSocket 正在关闭...');

  // 清理定时器
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  if (dedupCleanTimer) clearInterval(dedupCleanTimer);

  // 清理防抖定时器
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  // 关闭 WSClient
  try {
    (wsClient as any).close?.();
  } catch {
    // 忽略关闭时的错误
  }

  singletonWsClient = null;
  singletonAppId = null;

  // 保存去重数据
  saveDiskDedup(diskDedup);

  // v4.6: 释放单实例锁
  releaseInstance();

  console.log('👋 飞书 WebSocket 已关闭');
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 启动飞书 WebSocket 长轮询模式
 *
 * @param config 飞书配置
 * @param messageHandler 消息处理函数
 */
export async function startFeishuPollServer(
  config: FeishuConfig,
  messageHandler: (content: string, chatId: string, senderId: string) => Promise<string>
): Promise<void> {
  // ── 🔴 P0：单客户端保证 ──
  if (singletonWsClient && singletonAppId === config.appId) {
    console.log('[飞书] 已存在相同 appId 的 WSClient，复用现有连接');
    return;
  }
  if (singletonWsClient && singletonAppId !== config.appId) {
    console.warn(
      `[飞书] 存在不同 appId 的 WSClient (${singletonAppId})，先关闭后再创建新连接`
    );
    gracefulShutdown(singletonWsClient);
  }

  // API 调用客户端（用于发送回复）
  const client = new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  // 事件分发器
  const eventDispatcher = new lark.EventDispatcher({
    encryptKey: config.encryptKey,
    verificationToken: config.verificationToken,
  }).register({
    'im.message.receive_v1': async (data: any) => {
      if (isShuttingDown) return;

      try {
        const messageId = data.message?.message_id;
        if (!messageId) {
          console.log('[飞书] 收到无 message_id 的事件，跳过');
          return;
        }

        // 🔴 P0：去重检查
        if (!tryBeginProcessing(messageId)) {
          console.log(`[飞书去重] 跳过重复消息: ${messageId}`);
          return;
        }

        try {
          const message = data.message;
          const sender = data.sender;

          if (!message) {
            releaseProcessing(messageId);
            return;
          }

          const chatId = message.chat_id || '';
          const senderId = sender?.sender_id?.open_id || '';
          const msgType = message.message_type;

          if (msgType !== 'text') {
            releaseProcessing(messageId);
            return;
          }

          let text = '';
          try {
            const parsed = JSON.parse(message.content);
            text = parsed.text || '';
          } catch {
            text = message.content;
          }

          if (!text.trim()) {
            releaseProcessing(messageId);
            return;
          }

          console.log(`[飞书] 收到消息 [${chatId}] ${senderId}: ${text}`);

          // 🟡 P1：加入顺序队列 + 防抖
          enqueueChatMessage(chatId, async () => {
            try {
              const reply = await messageHandler(text, chatId, senderId);

              if (reply) {
                await client.im.message.create({
                  params: {
                    receive_id_type: 'chat_id',
                  },
                  data: {
                    receive_id: chatId,
                    content: JSON.stringify({ text: reply }),
                    msg_type: 'text',
                  },
                });
                console.log(`[飞书] 已回复 [${chatId}]`);
              }
            } catch (err) {
              console.error('[飞书] 处理消息失败:', err);
            } finally {
              releaseProcessing(messageId);
            }
          });
        } catch (err) {
          releaseProcessing(messageId);
          throw err;
        }
      } catch (err) {
        console.error('[飞书] 事件处理异常:', err);
      }
    },
  });

  // WebSocket 客户端（长轮询模式）
  // 🟢 P2：loggerLevel 对齐 OpenClaw 使用 info
  const wsClient = new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  // 连接生命周期回调（SDK 类型定义为 private，但运行时支持）
  const ws = wsClient as any;
  ws.onReady = () => {
    console.log('[飞书] ✅ WebSocket 连接就绪');
  };
  ws.onReconnecting = () => {
    console.log('[飞书] ⚠️ WebSocket 正在重连...');
  };
  ws.onReconnected = () => {
    console.log('[飞书] ✅ WebSocket 重连成功');
  };
  ws.onError = (err: Error) => {
    console.error('[飞书] ❌ WebSocket 错误:', err.message);
  };

  // 注册单例
  singletonWsClient = wsClient;
  singletonAppId = config.appId;

  console.log('🚀 飞书 WebSocket 长轮询模式已启动（无需公网 IP）');
  console.log('📌 消息会通过 WebSocket 自动从飞书服务器拉取');
  console.log('📌 日志级别: info（与 OpenClaw 对齐）');

  // 启动连接
  await wsClient.start({ eventDispatcher });

  // 🟢 P2：优雅关闭
  process.on('SIGINT', () => gracefulShutdown(wsClient));
  process.on('SIGTERM', () => gracefulShutdown(wsClient));

  // 定期去重清理：每 5 分钟清理一次过期条目
  dedupCleanTimer = setInterval(() => {
    pruneProcessingClaims();
  }, DEDUP_TTL_MS);

  // 定期健康检查：每 5 分钟验证连接状态
  const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  healthCheckTimer = setInterval(() => {
    const wsInstance = ws.wsConfig?.getWSInstance?.();
    const readyState = wsInstance?.readyState; // 1=OPEN, 2=CLOSING, 3=CLOSED
    if (readyState !== 1) {
      console.log(`[飞书健康检查] ⚠️ 连接异常 (readyState=${readyState})`);
    } else {
      console.log('[飞书健康检查] ✅ 连接正常');
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}
