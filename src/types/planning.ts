/**
 * @file planning.ts — 规划相关类型
 * @description
 *   两阶段架构的 Phase 1（Planning）类型定义：
 *   - StructuredPlan: 结构化执行计划
 *   - PlanStep: 计划步骤
 *   - PlanChunk: 分块执行单元
 *   - SuggestedConfig: 推荐配置
 *
 * 规划流程：
 * 用户需求 + 可用工具箱 → LLM 分析 → StructuredPlan → Phase 2 执行
 *
 * @module types/planning
 */

import type { ModelConfig } from "./config.js";

// ============================================================================
// 计划步骤
// ============================================================================

/**
 * 计划中的单个步骤
 */
export interface PlanStep {
  /** 步骤序号 */
  stepNumber: number;
  /** 步骤描述 */
  description: string;
  /** 需要的工具箱 ID 列表 */
  requiredToolboxes: string[];
  /** 期望输入 */
  expectedInput: string;
  /** 期望输出 */
  expectedOutput: string;
  /** 依赖的步骤序号（null 表示无依赖） */
  dependsOn?: number;
}

// ============================================================================
// 计划分块
// ============================================================================

/**
 * 计划分块：当任务过大时，将计划拆分为多个 chunk
 */
export interface PlanChunk {
  /** 分块序号 */
  chunkNumber: number;
  /** 该分块包含的步骤 */
  steps: PlanStep[];
  /** 预估 token 消耗 */
  estimatedTokens: number;
  /** 该分块的 system prompt 增强 */
  chunkSystemPrompt: string;
}

// ============================================================================
// 推荐配置
// ============================================================================

/**
 * 规划器推荐的运行时配置
 *
 * 在 Phase 1 生成，Phase 2 执行时与默认配置和用户配置合并。
 */
export interface SuggestedConfig {
  /** 推荐的最大轮数 */
  maxTurns?: number;
  /** 推荐的工具超时 */
  toolTimeout?: number;
  /** 推荐的上下文溢出策略 */
  contextOverflowStrategy?: "summarize" | "truncate" | "error";
  /** 推荐的工具选择策略 */
  toolSelectionStrategy?: "all" | "toolbox" | "auto";
  /** 推荐的模型覆盖 */
  modelOverrides?: Partial<ModelConfig>;
  /** 推荐的 thinking 级别 */
  thinkingLevel?: "disabled" | "light" | "medium" | "heavy";
  /** 是否启用分块执行 */
  chunkExecution?: boolean;
  /** 分块执行的 token 预算 */
  chunkTokenBudget?: number;
  /** 并行策略 */
  parallelism?: "sequential" | "safe-parallel" | "full-parallel";
  /** 风险等级 */
  riskLevel?: "low" | "medium" | "high";
}

// ============================================================================
// 结构化计划
// ============================================================================

/**
 * 结构化执行计划（Phase 1 的产物）
 *
 * 由 LLM 根据用户需求和可用工具箱生成，包含：
 * - 步骤分解
 * - 工具箱选择
 * - 配置推荐
 * - Token 预估
 * - 风险等级
 * - 输出规格
 */
export interface StructuredPlan {
  /** 计划摘要 */
  summary: string;
  /** 执行步骤列表 */
  steps: PlanStep[];
  /** 需要的工具箱 ID 列表 */
  requiredToolboxes: string[];
  /** 推荐的运行时配置 */
  suggestedConfig: SuggestedConfig;
  /** Token 消耗预估 */
  estimatedTokens: {
    promptTokens: number;
    completionTokens: number;
    toolResultTokens: number;
    total: number;
  };
  /** 上下文策略 */
  contextStrategy: {
    /** 执行模式 */
    mode: "normal" | "chunked" | "summarize" | "truncate";
    /** 分块列表（chunked 模式下有效） */
    chunks?: PlanChunk[];
    /** 原因说明 */
    reason: string;
  };
  /** 是否需要用户确认 */
  requiresConfirmation: boolean;
  /** 确认消息（需要确认时有效） */
  confirmationMessage?: string;
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high";
  /** 成本预估 */
  estimatedCost: {
    inputTokens: number;
    outputTokens: number;
    totalUSD: number;
  };
  /** 输出规格 */
  outputSpec: {
    /** 响应语言 */
    language: string;
    /** 响应格式 */
    format: "text" | "markdown" | "structured";
    /** 预期产出描述 */
    expectedDeliverable: string;
  };
  /** 回退计划 */
  fallbackPlan: {
    /** 是否降级为简单模式 */
    degradeToSimple: boolean;
    /** 降级后的最大轮数 */
    degradedMaxTurns: number;
  };
}
