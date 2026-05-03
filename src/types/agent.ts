/**
 * @file agent.ts — Agent 运行结果类型
 * @description
 *   Agent 执行后的返回。
 *
 * @module types/agent
 */

import type { ToolStats } from "./stats.js";
import type { ToolRegistry } from "./tool.js";

// ============================================================================
// Agent 运行结果
// ============================================================================

/**
 * Agent 运行结果
 *
 * runAgent() 执行完毕后返回，包含：
 * - 最终回复文本
 * - 工具调用统计
 * - 本轮使用过的工具
 */
export interface AgentRunResult {
  /** 最终回复 */
  reply: string;
  /** 工具调用总次数 */
  totalToolCalls: number;
  /** 各工具的详细统计 */
  toolStats: Map<string, ToolStats>;
  /** 本轮使用过的工具名称列表 */
  usedTools: string[];
}

/**
 * Agent 运行选项
 *
 * 传入 runAgent() 的可选参数。
 */
export interface AgentRunOptions {
  /** 系统提示词覆盖 */
  systemPrompt?: string;
  /** 工具注册表覆盖（默认使用全局） */
  registry?: ToolRegistry;
  /** Agent 层配置覆盖 */
  agentConfig?: Record<string, unknown>;
  /** 模型层配置覆盖 */
  modelConfig?: Record<string, unknown>;
}
