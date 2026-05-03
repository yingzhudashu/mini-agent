/**
 * @file config.ts — 模型与 Agent 配置管理
 * @description
 *   提供双层配置体系，将「模型层」和「Agent 层」的配置分离。
 *
 *   v4.5 更新：支持环境变量覆盖关键参数，方便在不同部署环境下调整行为。
 *   v4.6 更新：新增上下文管理配置（contextWindow、contextCompressThreshold）。
 *
 * @module core/config
 */

import type { ModelConfig, ModelProfile, AgentConfig, LoopDetectionConfig } from "./types.js";

/**
 * 模型配置预设
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
 * 从环境变量读取整数值
 */
function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v !== undefined) {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

/**
 * 从环境变量读取布尔值
 */
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v !== undefined) {
    return ["true", "1", "yes"].includes(v.toLowerCase());
  }
  return fallback;
}

/**
 * 循环检测默认配置
 *
 * v4.5 放宽：historySize 30→50, warning 5→8, critical 8→12
 * 支持环境变量覆盖：
 * - LOOP_DETECTION_ENABLED: 是否启用
 * - LOOP_HISTORY_SIZE: 历史窗口大小
 * - LOOP_WARNING_THRESHOLD: 警告阈值
 * - LOOP_CRITICAL_THRESHOLD: 严重阈值
 */
export const DEFAULT_LOOP_DETECTION: LoopDetectionConfig = {
  enabled: envBool("LOOP_DETECTION_ENABLED", true),
  historySize: envInt("LOOP_HISTORY_SIZE", 50),
  warningThreshold: envInt("LOOP_WARNING_THRESHOLD", 8),
  criticalThreshold: envInt("LOOP_CRITICAL_THRESHOLD", 12),
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
  },
};

/**
 * 获取默认 ModelConfig
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
    // v4.6: 上下文窗口（token），默认 qwen3.6-plus 为 128K
    contextWindow: envInt("AGENT_CONTEXT_WINDOW", 128000),
    stream: false,
    retryCount: 2,
    profiles: MODEL_PROFILES,
    activeProfile: profile,
  };
}

/**
 * 获取默认 AgentConfig
 *
 * v4.5 放宽：maxTurns 10→20, toolTimeout 30→60, httpTimeout 60→120
 * v4.6 新增：contextCompressThreshold 上下文压缩触发阈值
 * 支持环境变量覆盖：
 * - AGENT_MAX_TURNS: 最大对话轮数（默认 20）
 * - AGENT_TOOL_TIMEOUT: 工具超时秒数（默认 60）
 * - AGENT_HTTP_TIMEOUT: HTTP 超时秒数（默认 120）
 * - AGENT_CONTEXT_RESERVE: 上下文预留比例（默认 0.15）
 * - AGENT_CONTEXT_COMPRESS_THRESHOLD: 压缩触发阈值（默认 0.6，即 60% 窗口）
 * - AGENT_DEBUG: 调试模式
 * - AGENT_LOG_TOKEN_USAGE: 记录 token 使用量
 */
export function getDefaultAgentConfig(): AgentConfig {
  return {
    maxTurns: envInt("AGENT_MAX_TURNS", 20),
    toolTimeout: envInt("AGENT_TOOL_TIMEOUT", 60),
    httpTimeout: envInt("AGENT_HTTP_TIMEOUT", 120),
    contextReserveRatio: parseFloat(process.env.AGENT_CONTEXT_RESERVE ?? "0.15"),
    contextCompressThreshold: parseFloat(process.env.AGENT_CONTEXT_COMPRESS_THRESHOLD ?? "0.6"),
    contextOverflowStrategy: "summarize",
    compressMessages: true,
    toolSelectionStrategy: "toolbox",
    autoExecuteConfirmed: false,
    allowParallelTools: true,
    responseLanguage: "zh-CN",
    responseFormat: "markdown",
    debug: envBool("AGENT_DEBUG", false),
    logTokenUsage: envBool("AGENT_LOG_TOKEN_USAGE", true),
    logFile: null,
    loopDetection: DEFAULT_LOOP_DETECTION,
  };
}

/**
 * 应用模型预设到 ModelConfig
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
 */
export function mergeAgentConfig(base: AgentConfig, overrides: Partial<AgentConfig>): AgentConfig {
  const merged = { ...base, ...overrides };

  if (overrides.loopDetection) {
    merged.loopDetection = {
      ...base.loopDetection,
      ...overrides.loopDetection,
    };
  }

  return merged;
}
