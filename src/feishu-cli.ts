/**
 * @file feishu-cli.ts — 飞书 CLI 入口
 * @description
 *   启动飞书 Webhook 服务器，将收到的消息路由到 mini-agent 处理。
 *
 *   使用方式：
 *   1. 在飞书开放平台创建企业自建应用
 *   2. 获取 App ID 和 App Secret
 *   3. 配置事件订阅 → 消息与群组 → 接收消息 im.message.receive_v1
 *   4. 配置请求地址: https://your-domain:9800/webhook
 *   5. 运行: npm run feishu
 *
 *   环境变量：
 *   - FEISHU_APP_ID: 飞书 App ID (必填)
 *   - FEISHU_APP_SECRET: 飞书 App Secret (必填)
 *   - FEISHU_PORT: Webhook 端口 (默认 9800)
 *
 * @module feishu-cli
 */

import 'dotenv/config';
import { runAgent, DefaultToolRegistry, DefaultToolMonitor } from './index.js';
import { filesystemTools } from './tools/filesystem.js';
import { execTools } from './tools/exec.js';
import { webTools } from './tools/web.js';
import { skillsTools } from './tools/skills.js';
import { selfOptTools } from './tools/self-opt.js';
import { startFeishuServer } from './feishu/server.js';
import type { FeishuConfig } from './feishu/types.js';

// 读取飞书配置
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const port = parseInt(process.env.FEISHU_PORT || '9800', 10);

if (!appId || !appSecret) {
  console.error('❌ 缺少飞书配置');
  console.error('请设置环境变量:');
  console.error('  FEISHU_APP_ID=your_app_id');
  console.error('  FEISHU_APP_SECRET=your_app_secret');
  process.exit(1);
}

const feishuConfig: FeishuConfig = {
  appId,
  appSecret,
  port,
};

// 初始化 Agent 运行环境
const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

// 注册所有工具
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(skillsTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(selfOptTools)) registry.register(name, tool);

// 消息处理函数
async function handleMessage(
  content: string,
  _chatId: string,
  _senderId: string
): Promise<string> {
  try {
    console.log(`[Agent] 处理消息: ${content.slice(0, 50)}...`);

    const result = await runAgent(content, {
      registry,
      monitor,
    });

    return result;
  } catch (err) {
    console.error(`[飞书] Agent 处理失败:`, err);
    return '抱歉，处理您的消息时出现了错误。';
  }
}

// 启动服务器
console.log('🦞 Mini Agent 飞书模式启动中...');
startFeishuServer(feishuConfig, handleMessage);

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n👋 飞书服务器已停止');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 飞书服务器已停止');
  process.exit(0);
});
