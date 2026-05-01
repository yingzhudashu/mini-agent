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
 *   │  - profiles（模型预设，v4.1 新增）         │
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
 *   │  - loop_detection（循环检测，v4.1 新增）   │
 *   │  └─ 可被规划器的 suggestedConfig 覆盖      │
 *   └─────────────────────────────────────────┘
 *
 *   模型预设（Model Profiles，v4.1 新增）：
 *   - creative: 高创造性任务（写作、头脑风暴）
 *   - balanced: 平衡模式（默认，日常任务）
 *   - precise: 精确模式（数据分析、代码审查）
 *   - code: 编程模式（代码生成、调试）
 *   - fast: 快速模式（简单问答）
 *
 * @module core/config
 */

import type { ModelConfig, ModelProfile, AgentConfig, LoopDetectionConfig } from "./types.js";

/**
 * 模型配置预设
 *
 * 参考 OpenClaw 的 model profiles 设计，针对不同任务类型提供预调优的参数组合。
 *
 * | 预设 | temperature | thinking | maxTokens | 适用场景 |
 * |------|-------------|----------|-----------|---------|
 * | creative | 0.9 | disabled | 8192 | 写作、头脑风暴 |
 * | balanced | 0.7 | light | 4096 | 日常任务（默认） |
 * | precise | 0.3 | medium | 4096 | 数据分析、代码审查 |
 * | code | 0.2 | light | 8192 | 代码生成、调试 |
 * | fast | 0.3 | disabled | 2048 | 简单问答 |
 */
export const MODEL_PROFILES: Record<string, ModelProfile> = {
  creative: {
    name: "creative",
    temperature: 0.9,
    topP: 1.0,
    maxTokens: 8192,
    thinkingLevel: "disabled",
    thinkingBudget: 0,
    description: "高创造性任务：写作、头脑风暴、创意生成",
  },
  balanced: {
    name: "balanced",
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    thinkingLevel: "light",
    thinkingBudget: 1024,
    description: "平衡模式：日常任务、通用问答（默认）",
  },
  precise: {
    name: "precise",
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 4096,
    thinkingLevel: "medium",
    thinkingBudget: 2048,
    description: "精确模式：数据分析、代码审查、事实查询",
  },
  code: {
    name: "code",
    temperature: 0.2,
    topP: 0.9,
    maxTokens: 8192,
    thinkingLevel: "light",
    thinkingBudget: 2048,
    description: "编程模式：代码生成、调试、重构",
  },
  fast: {
    name: "fast",
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    thinkingLevel: "disabled",
    thinkingBudget: 0,
    description: "快速模式：简单问答、快速查询",
  },
};

/**
 * 循环检测默认配置
 *
 * 参考 OpenClaw 的 loop-detection 设计。
 * 默认启用，阈值经过调优以减少误报。
 */
export const DEFAULT_LOOP_DETECTION: LoopDetectionConfig = {
  enabled: true,
  historySize: 30,
  warningThreshold: 5,
  criticalThreshold: 8,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
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
 * - MODEL_PROFILE：模型预设名称（creative | balanced | precise | code | fast）
 *
 * @returns 默认模型配置
 */
export function getDefaultModelConfig(): ModelConfig {
  const profile = process.env.MODEL_PROFILE ?? "balanced";
  const preset = MODEL_PROFILES[profile] ?? MODEL_PROFILES.balanced;

  return {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: preset.temperature,
    topP: preset.topP,
    maxTokens: preset.maxTokens,
    thinkingLevel: preset.thinkingLevel,
    thinkingBudget: preset.thinkingBudget,
    contextWindow: 8192,
    stream: false,
    retryCount: 2,
    profiles: MODEL_PROFILES,
    activeProfile: profile,
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
    maxTurns: 10,
    toolTimeout: 30,
    httpTimeout: 60,
    contextReserveRatio: 0.2,
    contextOverflowStrategy: "summarize",
    compressMessages: true,
    toolSelectionStrategy: "toolbox",
    autoExecuteConfirmed: false,
    allowParallelTools: true,
    responseLanguage: "zh-CN",
    responseFormat: "markdown",
    debug: false,
    logTokenUsage: true,
    logFile: null,
    loopDetection: DEFAULT_LOOP_DETECTION,
  };
}

/**
 * 应用模型预设到 ModelConfig
 *
 * 将指定预设的参数应用到配置中，未指定的字段保持原值。
 *
 * @param config - 当前模型配置
 * @param profileName - 预设名称
 * @returns 应用预设后的配置
 */
export function applyModelProfile(config: ModelConfig, profileName: string): ModelConfig {
  const profile = MODEL_PROFILES[profileName];
  if (!profile) {
    console.warn(`⚠️ 未知模型预设: ${profileName}，使用 balanced`);
    return applyModelProfile(config, "balanced");
  }

  return {
    ...config,
    temperature: profile.temperature,
    topP: profile.topP,
    maxTokens: profile.maxTokens,
    thinkingLevel: profile.thinkingLevel,
    thinkingBudget: profile.thinkingBudget,
    activeProfile: profileName,
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
  const merged = { ...base, ...overrides };

  // 深度合并 loopDetection
  if (overrides.loopDetection) {
    merged.loopDetection = {
      ...base.loopDetection,
      ...overrides.loopDetection,
    };
  }

  return merged;
}
