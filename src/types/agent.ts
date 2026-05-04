/**
 * @file agent.ts — Agent 运行结果与统计类型
 * @description
 *   Agent 执行后的返回类型、性能监控统计、循环检测、线性管线。
 *
 * @module types/agent
 */

import type { ToolResult } from "./tool.js";
import type { ToolRegistry } from "./tool.js";

// ============================================================================
// Agent 运行结果
// ============================================================================

/**
 * Agent 运行结果
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

// ============================================================================
// 性能监控统计
// ============================================================================

/**
 * 单个工具的调用统计
 */
export interface ToolStats {
  /** 调用次数 */
  calls: number;
  /** 总耗时（毫秒） */
  totalMs: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failCount: number;
  /** 错误信息列表 */
  errors: string[];
}

/**
 * 工具监控器接口
 */
export interface ToolMonitor {
  /** 记录一次工具调用 */
  record(tool: string, durationMs: number, success: boolean): void;
  /** 获取单个工具的统计 */
  getStats(tool: string): ToolStats | undefined;
  /** 获取所有工具的统计 */
  getAllStats(): Map<string, ToolStats>;
  /** 生成统计报告（可读文本） */
  report(): string;
}

// ============================================================================
// 循环检测（v4.1）
// ============================================================================

/**
 * 循环检测配置
 */
export interface LoopDetectionConfig {
  /** 是否启用循环检测（默认 true） */
  enabled: boolean;
  /** 保留的最近工具调用历史条数（默认 30） */
  historySize: number;
  /** 警告阈值（默认 5） */
  warningThreshold: number;
  /** 严重阈值（默认 8） */
  criticalThreshold: number;
  /** 检测器开关 */
  detectors: {
    genericRepeat: boolean;
    knownPollNoProgress: boolean;
    pingPong: boolean;
  };
}

/** 循环检测事件级别 */
export type LoopLevel = "none" | "warning" | "critical";

/** 循环检测结果 */
export interface LoopDetectionResult {
  /** 事件级别 */
  level: LoopLevel;
  /** 消息说明 */
  message: string;
  /** 重复的工具调用模式 */
  pattern?: string;
}

// ============================================================================
// 线性管线（Pipeline）
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
