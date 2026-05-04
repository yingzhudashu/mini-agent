/**
 * @file config.ts — 模型与 Agent 配置类型
 * @description
 *   Mini Agent 的双层配置体系：
 *   - ModelConfig：模型层（API 端点、temperature、thinking 等）
 *   - AgentConfig：Agent 层（maxTurns、toolTimeout、上下文策略等）
 *   - ModelProfile：模型配置预设（creative/balanced/precise 等）
 *
 * 参考 OpenClaw 的分层配置体系：
 * 基础配置 → 预设覆盖 → 运行时覆盖
 *
 * @module types/config
 */

import type { Toolbox, ToolRegistry } from "./tool.js";
import type { LoopDetectionConfig } from "./agent.js";

// ============================================================================
// Model Profile — 模型预设
// ============================================================================

/**
 * 模型配置预设
 *
 * 针对不同复杂度任务提供预调优的模型参数。
 */
export interface ModelProfile {
  /** 预设名称 */
  name: string;
  /** 温度（创造性 vs 确定性） */
  temperature: number;
  /** top_p 采样 */
  topP: number;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** thinking 级别 */
  thinkingLevel: "disabled" | "light" | "medium" | "heavy";
  /** thinking token 预算 */
  thinkingBudget: number;
  /** 适用场景描述 */
  description: string;
}

/** 内置预设名称 */
export type BuiltInProfile = "creative" | "balanced" | "precise" | "code" | "fast";

// ============================================================================
// ModelConfig — 模型层配置
// ============================================================================

/**
 * 模型配置
 *
 * 参考 OpenClaw 的分层配置体系：
 * 基础配置 + 预设覆盖 + 运行时覆盖
 */
export interface ModelConfig {
  /** API 端点 */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** 温度（0.0-2.0） */
  temperature: number;
  /** top_p 采样（0.0-1.0） */
  topP: number;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** thinking 级别（适用于支持 thinking 的模型） */
  thinkingLevel: "disabled" | "light" | "medium" | "heavy";
  /** thinking token 预算 */
  thinkingBudget: number;
  /** 上下文窗口大小（token） */
  contextWindow: number;
  /** 是否使用流式输出 */
  stream: boolean;
  /** API 调用重试次数 */
  retryCount: number;
  /** 模型配置预设（用于快速切换） */
  profiles?: Record<string, ModelProfile>;
  /** 当前使用的预设名称 */
  activeProfile?: string;
}

// ============================================================================
// AgentConfig — Agent 层配置
// ============================================================================

/**
 * Agent 配置
 *
 * 参考 OpenClaw 的配置体系：
 * - maxTurns / loopDetection: 防止无限循环
 * - contextOverflowStrategy: 上下文溢出处理
 * - toolSelectionStrategy: 工具选择策略
 * - modelOverrides: 运行时模型覆盖
 *
 * 配置合并优先级（从低到高）：
 * 1. getDefaultAgentConfig() — 默认值
 * 2. runAgent(options.agentConfig) — 用户传入
 * 3. plan.suggestedConfig — 规划器推荐
 */
export interface AgentConfig {
  /** 最大轮数（ReAct loop 迭代次数，默认 10） */
  maxTurns: number;
  /** 工具超时（秒，默认 30） */
  toolTimeout: number;
  /** HTTP 超时（秒，默认 60） */
  httpTimeout: number;
  /** 上下文保留比例（默认 0.2，即保留 20% 窗口给新输入） */
  contextReserveRatio: number;
  /** 上下文触发压缩的阈值比例（默认 0.7，即使用 70% 窗口时触发） */
  contextCompressThreshold: number;
  /** 上下文溢出处理策略 */
  contextOverflowStrategy: "summarize" | "truncate" | "error";
  /** 是否压缩消息（移除冗余空白、缩短工具结果） */
  compressMessages: boolean;
  /** 工具选择策略 */
  toolSelectionStrategy: "all" | "toolbox" | "auto";
  /** 是否自动确认执行（跳过 onPlan 确认） */
  autoExecuteConfirmed: boolean;
  /** 是否允许并行工具调用 */
  allowParallelTools: boolean;
  /** 响应语言（默认 zh-CN） */
  responseLanguage: string;
  /** 响应格式 */
  responseFormat: "text" | "markdown" | "structured";
  /** 调试模式 */
  debug: boolean;
  /** 是否记录 token 用量 */
  logTokenUsage: boolean;
  /** 增量日志文件路径，null 则不记录 */
  logFile: string | null;
  /** 输出管理器（用于 CLI 稳定输出） */
  outputManager?: {
    beginOutput(): void;
    endOutput(): void;
    write(text: string): void;
    writeLines(lines: string[]): void;
  } | null;
  /** 循环检测配置（v4.1 新增） */
  loopDetection?: Partial<LoopDetectionConfig>;
  /** 模型覆盖（运行时可动态切换模型参数） */
  modelOverrides?: Partial<ModelConfig>;
  /** 会话记忆（v4.6 新增，可选） */
  sessionKey?: string;
  /** 会话级工具注册表（v4.7 新增） */
  sessionRegistry?: ToolRegistry;
  /** 会话工作空间路径（v4.7 新增） */
  sessionWorkspace?: string;
  /** 会话工具箱列表（v4.7 新增） */
  sessionToolboxes?: Toolbox[];
  /** 对话历史（跨轮次保留，v4.9.3 新增） */
  conversationHistory?: Array<{ role: string; content: string }>;
}
