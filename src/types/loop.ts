/**
 * @file loop.ts — 循环检测类型
 * @description
 *   参考 OpenClaw 的 loop-detection 机制，防止 Agent 陷入无限循环。
 *
 *   检测器类型：
 *   1. genericRepeat — 检测相同工具 + 相同参数的重复调用
 *   2. knownPollNoProgress — 检测已知轮询模式但无状态变化
 *   3. pingPong — 检测交替的 A→B→A→B 模式
 *
 * @module types/loop
 */

// ============================================================================
// 循环检测配置
// ============================================================================

/**
 * 循环检测配置
 *
 * 参考 OpenClaw 的 loop-detection 机制，防止 Agent 陷入无限循环。
 *
 * 检测器类型：
 * - genericRepeat: 检测相同工具 + 相同参数的重复调用
 * - knownPollNoProgress: 检测已知轮询模式但无状态变化
 * - pingPong: 检测交替的 ping-pong 模式
 */
export interface LoopDetectionConfig {
  /** 是否启用循环检测（默认 true） */
  enabled: boolean;
  /** 保留的最近工具调用历史条数（默认 30） */
  historySize: number;
  /** 警告阈值：超过此次数标记为 warning（默认 5） */
  warningThreshold: number;
  /** 严重阈值：超过此次数强制终止（默认 8） */
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
