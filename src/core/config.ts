/**
 * @file config.ts — 模型与 Agent 配置管理
 * @description
 *   提供双层配置体系，将「模型层」和「Agent 层」的配置分离。
 *
 *   ┌─────────────────────────────────────────┐
 *   │  ModelConfig（模型层）                    │
 *   │  - API 端点、模型名称                     │
 *   │  - temperature / top_p / max_tokens      │
 *   │  - thinking_level / thinking_budget       │
 *   │  - context_window（上下文窗口）            │
 *   │  └─ 来源：.env / 模型厂商推荐              │
 *   └──────────────┬──────────────────────────┘
 *                  │
 *   ┌──────────────▼──────────────────────────┐
 *   │  AgentConfig（Agent 层）                  │
 *   │  - max_turns（最大对话轮数）              │
 *   │  - tool_timeout（工具超时）               │
 *   │  - context_reserve_ratio（预留比例）       │
 *   │  - overflow_strategy（溢出策略）           │
 *   │  - tool_selection_strategy（工具筛选策略）  │
 *   │  └─ 可被规划器的 suggestedConfig 覆盖      │
 *   └─────────────────────────────────────────┘
 *
 *   配置预设：
 *   - fast：快速模式，低延迟，适合简单问答
 *   - balanced：平衡模式，默认，适合日常任务
 *   - deep：深度模式，高 token 预算，适合复杂多步任务
 *
 * @module core/config
 */

import type { ModelConfig, AgentConfig } from "./types.js";

/**
 * 模型配置预设
 *
 * 三种预设覆盖从轻量到深度的使用场景：
 * - fast：temperature 0.3（确定性高）、无深度思考、max_turns=3
 * - balanced：temperature 0.7（创造力适中）、轻度思考、max_turns=5
 * - deep：temperature 0.5（兼顾准确和灵活）、深度思考、max_turns=15
 *
 * 这些值参考了模型厂商（DashScope/Anthropic/OpenAI）的推荐实践。
 */
export const MODEL_PRESETS = {
  /** 快速模式：低延迟，适合简单问答 */
  fast: {
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    thinkingLevel: "disabled" as const,
    thinkingBudget: 0,
    maxTurns: 3,
    toolTimeout: 15,
  },
  /** 平衡模式：默认，适合日常任务 */
  balanced: {
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    thinkingLevel: "light" as const,
    thinkingBudget: 1024,
    maxTurns: 5,
    toolTimeout: 30,
  },
  /** 深度模式：高 token 预算，适合复杂多步任务 */
  deep: {
    temperature: 0.5,
    topP: 0.95,
    maxTokens: 8192,
    thinkingLevel: "heavy" as const,
    thinkingBudget: 4096,
    maxTurns: 15,
    toolTimeout: 60,
  },
};

/**
 * 获取默认 ModelConfig
 *
 * 优先从环境变量读取，否则使用安全默认值。
 *
 * 环境变量：
 * - OPENAI_BASE_URL：API 端点（如 DashScope）
 * - OPENAI_MODEL：模型名称（如 qwen3.6-plus）
 *
 * @returns 默认模型配置
 */
export function getDefaultModelConfig(): ModelConfig {
  return {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    thinkingLevel: "light",
    thinkingBudget: 1024,
    contextWindow: 8192,
    stream: false,
    retryCount: 2,
  };
}

/**
 * 获取默认 AgentConfig
 *
 * AgentConfig 控制 Agent 的运行行为，而非模型本身。
 * 这些值可被 runAgent() 的 options 参数和规划器的 suggestedConfig 覆盖。
 *
 * @returns 默认 Agent 配置
 */
export function getDefaultAgentConfig(): AgentConfig {
  return {
    maxTurns: 5,
    toolTimeout: 30,
    httpTimeout: 15,
    contextReserveRatio: 0.8,
    contextOverflowStrategy: "summarize",
    compressMessages: true,
    toolSelectionStrategy: "toolbox",
    autoExecuteConfirmed: false,
    allowParallelTools: true,
    responseLanguage: "zh-CN",
    responseFormat: "markdown",
    debug: false,
    logTokenUsage: true,
  };
}

/**
 * 合并 Agent 配置
 *
 * 使用对象展开运算符合并基础配置和覆盖配置。
 * 覆盖配置中的值会替换基础配置中同名属性（浅合并）。
 *
 * 合并优先级（从低到高）：
 * 1. getDefaultAgentConfig() — 默认值
 * 2. runAgent(options.agentConfig) — 用户显式传入
 * 3. plan.suggestedConfig — 规划器推荐
 *
 * @param base - 基础配置
 * @param overrides - 覆盖配置
 * @returns 合并后的配置
 */
export function mergeAgentConfig(base: AgentConfig, overrides: Partial<AgentConfig>): AgentConfig {
  return { ...base, ...overrides };
}
