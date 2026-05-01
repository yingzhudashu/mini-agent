/**
 * @file server.ts — 飞书 Webhook 服务器
 * @description
 *   接收飞书开放平台的事件推送，处理 URL 验证和消息事件。
 *
 *   工作流程：
 *   1. 飞书开放平台 → POST /webhook → 验证 challenge
 *   2. 收到消息事件 → 解析 → 路由到 handler
 *   3. handler 调用 Agent → 获取回复 → 发送回飞书
 *
 * @module feishu/server
 */

import http from 'node:http';
import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './types.js';

/**
 * 创建飞书 Webhook HTTP 服务器
 *
 * @param config 飞书配置
 * @param messageHandler 消息处理函数 (消息文本) => (回复文本)
 * @returns HTTP Server 实例
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
 * 处理飞书事件
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
 * 启动飞书 Webhook 服务器
 *
 * @param config 飞书配置
 * @param messageHandler 消息处理函数
 * @returns 服务器实例
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
