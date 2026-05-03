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

export interface FeishuHandlerDeps {
  registry: ToolRegistry;
  monitor: ToolMonitor;
  toolboxes?: Toolbox[];
  skills?: Skill[];
  skillPrompts?: string[];
}

/**
 * 飞书消息处理器（内嵌模式 + 独立模式共用）
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
