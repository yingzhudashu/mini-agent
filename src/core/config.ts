import type { ModelConfig, AgentConfig } from "./types.js";

// Default ModelConfig presets
export const MODEL_PRESETS = {
  fast: {
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    thinkingLevel: "disabled" as const,
    thinkingBudget: 0,
    maxTurns: 3,
    toolTimeout: 15,
  },
  balanced: {
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 4096,
    thinkingLevel: "light" as const,
    thinkingBudget: 1024,
    maxTurns: 5,
    toolTimeout: 30,
  },
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

export function mergeAgentConfig(base: AgentConfig, overrides: Partial<AgentConfig>): AgentConfig {
  return { ...base, ...overrides };
}
