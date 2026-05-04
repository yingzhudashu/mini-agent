/**
 * @file feishu/agent-handler.ts — 飞书消息处理（内嵌 + 独立模式复用）
 * @description
 *   v4.9.3 重构：从 cli.ts 和 feishu-cli.ts 提取公共逻辑
 *   统一处理 session 管理、conversationHistory、错误兜底
 * @module feishu/agent-handler
 */

import { runAgent } from "../core/agent.js";
import { getSessionManager } from "../session/manager.js";
import type { ToolRegistry, ToolMonitor, Toolbox, Skill } from "../types/index.js";

/**
 * 飞书消息处理器的依赖项
 *
 * @description 创建飞书消息处理器时需要传入的核心模块引用。
 */
export interface FeishuHandlerDeps {
  /** 工具注册表，用于提供 Agent 可调用的工具 */
  registry: ToolRegistry;
  /** 性能监控器，记录工具调用统计 */
  monitor: ToolMonitor;
  /** 可用工具箱列表（可选，空则跳过规划） */
  toolboxes?: Toolbox[];
  /** 已加载的技能列表（可选） */
  skills?: Skill[];
  /** 技能贡献的 system prompt 增强（可选） */
  skillPrompts?: string[];
}

/**
 * 创建飞书消息处理器（内嵌模式 + 独立模式共用）
 *
 * @param deps - 处理器所需的依赖项
 * @returns 消息处理函数 (content, chatId, senderId) => Promise<string>
 *
 * @example
 *   const handler = createFeishuHandler({
 *     registry,
 *     monitor,
 *     toolboxes: DEFAULT_TOOLBOXES,
 *   });
 *
 *   const reply = await handler('你好', 'chat_123', 'user_456');
 */
export function createFeishuHandler(deps: FeishuHandlerDeps) {
  const sessionManager = getSessionManager(deps.registry);

  return async function handleMessage(
    content: string,
    chatId: string,
    senderId: string,
  ): Promise<string> {
    try {
      console.log(`[飞书] 处理: ${content.slice(0, 50)}...`);

      const sessionKey = `feishu:${chatId || senderId || "default"}`;
      const sessionCtx = sessionManager.getOrCreate(sessionKey, {
        chatId,
        senderId,
      });

      const result = await runAgent(content, {
        registry: deps.registry,
        monitor: deps.monitor,
        toolboxes: deps.toolboxes,
        agentConfig: {
          debug: true,
          sessionKey,
          sessionRegistry: sessionCtx.registry,
          sessionWorkspace: sessionCtx.config.filesPath,
          conversationHistory: sessionCtx.conversationHistory,
        },
        systemPrompt:
          deps.skillPrompts && deps.skillPrompts.length > 0
            ? deps.skillPrompts.join("\n\n")
            : undefined,
      });

      // 更新对话历史
      sessionCtx.conversationHistory.push({ role: "user", content });
      sessionCtx.conversationHistory.push({
        role: "assistant",
        content: result,
      });

      return result;
    } catch (err) {
      console.error(`[飞书] 处理失败:`, err);
      return "抱歉，处理您的消息时出现了错误。";
    }
  };
}
