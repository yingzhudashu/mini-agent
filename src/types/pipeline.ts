/**
 * @file pipeline.ts — 线性管线执行类型
 * @description
 *   管线（Pipeline）是 ReAct 循环的替代方案，用于需要严格按序执行的场景。
 *   不支持 LLM 动态决策，按照预定义的步骤依次执行工具。
 *
 * @module types/pipeline
 */

import type { ToolResult } from "./tool.js";

// ============================================================================
// 管线步骤
// ============================================================================

/**
 * 管线中的单个步骤
 */
export interface PipelineStep {
  /** 要执行的工具名称 */
  tool: string;
  /** 工具调用参数 */
  args: Record<string, unknown>;
}

// ============================================================================
// 管线执行结果
// ============================================================================

/**
 * 管线执行结果
 */
export interface PipelineResult {
  /** 每个步骤的执行结果 */
  steps: {
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }[];
  /** 最终累积内容 */
  finalContent: string;
  /** 是否全部成功 */
  success: boolean;
}
