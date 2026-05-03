/**
 * @file stats.ts — 性能监控统计类型
 * @description
 *   工具调用性能监控的数据结构。
 *   自动记录每次工具调用的调用次数、耗时、成功/失败次数。
 *
 * @module types/stats
 */

// ============================================================================
// 工具统计
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

// ============================================================================
// 工具监控器接口
// ============================================================================

/**
 * 工具监控器接口
 *
 * 自动记录每次工具调用的性能数据。
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
