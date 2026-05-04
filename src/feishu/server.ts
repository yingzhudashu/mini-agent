/**
 * @file server.ts — 飞书 Webhook HTTP 服务器
 * @description
 *   接收飞书开放平台的事件推送，处理 URL 验证和消息事件。
 *
 *   与长轮询模式的区别：
 *   - Webhook 模式（本文件）：需要公网可达的 URL，飞书主动推送事件
 *   - 长轮询模式（poll-server.ts）：主动连接飞书服务器，无需公网 IP
 *
 *   工作流程：
 *   1. 飞书开放平台 → POST /webhook → 验证 challenge
 *   2. 收到消息事件 → 解析 → 路由到 handler
 *   3. handler 调用 Agent → 获取回复 → 通过飞书 API 发送回复
 *
 * @module feishu/server
 */

import http from 'node:http';
import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from '../types/index.js';

/**
 * 创建飞书 Webhook HTTP 服务器
 *
 * @param config - 飞书应用配置（App ID、Secret、端口等）
 * @param messageHandler - 消息处理函数，接收 (消息文本, 聊天ID, 发送者ID)，返回回复文本
 * @returns HTTP Server 实例，调用 .listen(port) 后开始监听
 *
 * @example
 *   const server = createFeishuServer(config, async (text) => `收到: ${text}`);
 *   server.listen(3000);
 */
export function createFeishuServer(
  config: FeishuConfig,
  messageHandler: (content: string, chatId: string, senderId: string) => Promise<string>
): http.Server {
  const client = new lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  const server = http.createServer(async (req, res) => {
    // 只接受 POST 请求
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk: string) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        // 处理 URL 验证 (challenge)
        if (data.type === 'url_verification') {
          console.log('[飞书] 收到 URL 验证请求');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ challenge: data.challenge }));
          return;
        }

        // 处理事件
        if (data.event) {
          await handleEvent(data, client, messageHandler);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 0 }));
      } catch (err) {
        console.error('[飞书] 处理请求失败:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
  });

  return server;
}

/**
 * 处理飞书事件（内部函数）
 *
 * 解析事件数据，验证事件类型，调用消息处理器生成回复，
 * 然后通过飞书 API 发送回复。
 *
 * @param data - 飞书事件原始数据（包含 event 字段）
 * @param client - 飞书 API 客户端（用于发送回复）
 * @param messageHandler - 消息处理函数，签名: (content, chatId, senderId) => Promise<reply>
 * @returns 无返回值，通过飞书 API 发送回复（side effect）
 */
async function handleEvent(
  data: Record<string, unknown>,
  client: lark.Client,
  messageHandler: (content: string, chatId: string, senderId: string) => Promise<string>
): Promise<void> {
  const event = data.event as Record<string, unknown> | undefined;
  if (!event) return;

  const header = event.header as Record<string, unknown> | undefined;
  const eventType = header?.event_type as string | undefined;

  // 只处理消息事件
  if (eventType !== 'im.message.receive_v1') {
    return;
  }

  const message = event.message as Record<string, unknown> | undefined;
  const sender = event.sender as Record<string, unknown> | undefined;
  if (!message || !sender) return;

  const msgType = message.msg_type as string;
  const chatId = event.chat_id as string;
  const senderId = (sender.sender_id as Record<string, unknown>)?.open_id as string;
  const messageId = message.message_id as string;

  // 只处理文本消息
  if (msgType !== 'text') {
    console.log(`[飞书] 忽略非文本消息: ${msgType}`);
    return;
  }

  const content = message.content as string;
  let text = '';
  try {
    const parsed = JSON.parse(content);
    text = parsed.text || '';
  } catch {
    text = content;
  }

  if (!text.trim()) return;

  console.log(`[飞书] 收到消息 [${chatId}] ${senderId}: ${text}`);

  // 调用 Agent 处理
  try {
    const reply = await messageHandler(text, chatId, senderId);

    // 发送回复
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
    console.error(`[飞书] 回复失败 [${chatId}]:`, err);
  }
}

/**
 * 创建并启动飞书 Webhook 服务器
 *
 * @param config - 飞书应用配置
 * @param messageHandler - 消息处理函数
 * @returns 已启动的 HTTP Server 实例
 *
 * @example
 *   const server = startFeishuServer(config, handleFeishuMessage);
 *   // 服务器已在指定端口上监听
 */
export function startFeishuServer(
  config: FeishuConfig,
  messageHandler: (content: string, chatId: string, senderId: string) => Promise<string>
): http.Server {
  const server = createFeishuServer(config, messageHandler);

  server.listen(config.port, () => {
    console.log(`🚀 飞书 Webhook 服务器已启动: http://0.0.0.0:${config.port}/webhook`);
    console.log(`📌 请在飞书开放平台配置请求地址: https://your-domain:${config.port}/webhook`);
  });

  return server;
}
