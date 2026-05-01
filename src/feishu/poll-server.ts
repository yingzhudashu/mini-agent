/**
 * @file poll-server.ts — 飞书 WebSocket 长轮询服务器
 * @description
 *   使用飞书 SDK 的 WSClient 长轮询模式接收事件推送。
 *
 *   与 Webhook 模式的区别：
 *   - Webhook 模式：需要公网可访问的 HTTP 地址，飞书主动推送
 *   - 长轮询模式：SDK 通过 WebSocket 连接飞书服务器，无需公网 IP
 *
 *   这就是 OpenClaw 的飞书通道工作原理——只需填密钥，不需要公网 IP。
 *
 * @module feishu/poll-server
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './types.js';

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
      try {
        // SDK 数据结构是扁平的，不是 data.event.xxx
        const message = data.message;
        const sender = data.sender;

        if (!message) {
          console.log('[飞书] 收到空消息事件，跳过:', JSON.stringify(data).slice(0, 200));
          return;
        }

        const chatId = message.chat_id || '';
        const senderId = sender?.sender_id?.open_id || '';
        const msgType = message.message_type;

        // 只处理文本消息
        if (msgType !== 'text') {
          console.log(`[飞书] 忽略非文本消息: ${msgType}`);
          return;
        }

        let text = '';
        try {
          const parsed = JSON.parse(message.content);
          text = parsed.text || '';
        } catch {
          text = message.content;
        }

        if (!text.trim()) return;

        console.log(`[飞书] 收到消息 [${chatId}] ${senderId}: ${text}`);

        // 调用 Agent 处理
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
        console.error('[飞书] 处理消息失败:', err);
      }
    },
  });

  // WebSocket 客户端（长轮询模式）
  const wsClient = new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  console.log('🚀 飞书 WebSocket 长轮询模式已启动（无需公网 IP）');
  console.log('📌 消息会通过 WebSocket 自动从飞书服务器拉取');

  // 启动连接
  await wsClient.start({ eventDispatcher });
}
