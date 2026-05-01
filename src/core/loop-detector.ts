/**
 * @file loop-detector.ts — 循环检测器
 * @description
 *   参考 OpenClaw 的 loop-detection 机制，防止 Agent 陷入无限循环。
 *
 *   检测器类型：
 *   1. genericRepeat — 检测相同工具 + 相同参数的重复调用
 *   2. knownPollNoProgress — 检测已知轮询模式但无状态变化
 *   3. pingPong — 检测交替的 A→B→A→B 模式
 *
 *   行为：
 *   - warningThreshold 以下：正常执行
 *   - warningThreshold ~ criticalThreshold：发出警告但不拦截
 *   - criticalThreshold 以上：强制终止循环
 *
 *   设计原则：
 *   - 渐进式：先警告、后拦截，给 Agent 自我修正的机会
 *   - 低误报：只有完全相同的调用才计数，避免阻断合法重试
 *   - 可配置：所有阈值都可动态调整
 *
 * @module core/loop-detector
 */

import type { LoopDetectionConfig, LoopDetectionResult, LoopLevel } from "./types.js";

/**
 * 工具调用记录
 */
interface CallRecord {
  tool: string;
  args: string; // JSON 序列化的参数（用于精确匹配）
  result: string; // 结果摘要（用于检测无进展轮询）
  timestamp: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: LoopDetectionConfig = {
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
 * 循环检测器
 *
 * 记录工具调用历史，在每次新调用前检测是否存在循环模式。
 *
 * @example
 *   const detector = new LoopDetector();
 *   detector.record("read_file", { path: "a.txt" }, "success");
 *   detector.record("read_file", { path: "a.txt" }, "success");
 *   // ... 重复 5 次后
 *   const result = detector.check("read_file", { path: "a.txt" });
 *   // result.level === "warning" | "critical"
 */
export class LoopDetector {
  private config: LoopDetectionConfig;
  private history: CallRecord[] = [];

  constructor(config?: Partial<LoopDetectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LoopDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 记录一次工具调用
   *
   * @param tool - 工具名称
   * @param args - 工具参数
   * @param result - 工具结果
   */
  record(tool: string, args: Record<string, unknown>, result: string): void {
    if (!this.config.enabled) return;

    this.history.push({
      tool,
      args: JSON.stringify(args),
      result: result.slice(0, 200), // 只保留前 200 字符
      timestamp: Date.now(),
    });

    // 保持历史记录在限制范围内
    if (this.history.length > this.config.historySize) {
      this.history = this.history.slice(-this.config.historySize);
    }
  }

  /**
   * 检查当前工具调用是否存在循环模式
   *
   * 检测顺序：
   * 1. genericRepeat — 相同工具 + 相同参数
   * 2. knownPollNoProgress — 轮询模式但结果无变化
   * 3. pingPong — 交替模式（A→B→A→B）
   *
   * @param tool - 即将调用的工具名称
   * @param args - 即将使用的参数
   * @returns 检测结果
   */
  check(tool: string, args: Record<string, unknown>): LoopDetectionResult {
    if (!this.config.enabled) return { level: "none", message: "" };

    const argsStr = JSON.stringify(args);

    // ── 检测 1: genericRepeat（相同工具 + 相同参数） ──
    if (this.config.detectors.genericRepeat) {
      const repeatCount = this.history.filter(
        (r) => r.tool === tool && r.args === argsStr,
      ).length;

      if (repeatCount >= this.config.criticalThreshold) {
        return {
          level: "critical",
          message: `检测到循环：${tool} 已重复调用 ${repeatCount} 次（参数相同）。强制终止以避免无限循环。`,
          pattern: `${tool}(${argsStr}) x${repeatCount}`,
        };
      }

      if (repeatCount >= this.config.warningThreshold) {
        return {
          level: "warning",
          message: `⚠️ 警告：${tool} 已重复调用 ${repeatCount} 次（参数相同），请考虑改变策略。`,
          pattern: `${tool}(${argsStr}) x${repeatCount}`,
        };
      }
    }

    // ── 检测 2: knownPollNoProgress（轮询模式但结果无变化） ──
    if (this.config.detectors.knownPollNoProgress) {
      const pollPattern = this.detectPollPattern(tool, argsStr);
      if (pollPattern) return pollPattern;
    }

    // ── 检测 3: pingPong（交替模式） ──
    if (this.config.detectors.pingPong) {
      const pingPong = this.detectPingPong(tool, argsStr);
      if (pingPong) return pingPong;
    }

    return { level: "none", message: "" };
  }

  /**
   * 检测轮询模式：连续调用相同工具但结果无变化
   */
  private detectPollPattern(tool: string, argsStr: string): LoopDetectionResult | null {
    // 找最近连续相同工具+参数的调用
    const consecutive: CallRecord[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      const r = this.history[i];
      if (r.tool === tool && r.args === argsStr) {
        consecutive.unshift(r);
      } else if (consecutive.length > 0) {
        break; // 中断则停止计数
      }
    }

    if (consecutive.length < 3) return null;

    // 检查结果是否有变化（至少 3 次相同结果）
    const results = consecutive.map((r) => r.result);
    const uniqueResults = new Set(results);

    if (uniqueResults.size === 1 && consecutive.length >= this.config.warningThreshold) {
      const level = consecutive.length >= this.config.criticalThreshold ? "critical" : "warning";
      return {
        level,
        message: `检测到无进展轮询：${tool} 连续 ${consecutive.length} 次，结果无变化。`,
        pattern: `${tool} 轮询 x${consecutive.length}`,
      };
    }

    return null;
  }

  /**
   * 检测 ping-pong 模式：A→B→A→B→A→B
   */
  private detectPingPong(tool: string, argsStr: string): LoopDetectionResult | null {
    if (this.history.length < 6) return null;

    // 检查最近 6 条记录是否为交替模式
    const recent = this.history.slice(-6);
    const pattern = recent.map((r) => `${r.tool}:${r.args}`);

    // 检测 A-B-A-B-A-B 模式
    const a = pattern[0];
    const b = pattern[1];
    if (a === b) return null; // 不是交替

    const expected = [a, b, a, b, a, b];
    if (JSON.stringify(pattern) === JSON.stringify(expected)) {
      return {
        level: "warning",
        message: `检测到 ping-pong 模式：${a} ↔ ${b} 交替调用。`,
        pattern: `${a} ↔ ${b}`,
      };
    }

    return null;
  }

  /**
   * 获取当前统计信息
   */
  getStats(): { totalCalls: number; historySize: number; enabled: boolean } {
    return {
      totalCalls: this.history.length,
      historySize: this.config.historySize,
      enabled: this.config.enabled,
    };
  }

  /**
   * 清空历史记录
   */
  clear(): void {
    this.history = [];
  }
}

/**
 * 默认循环检测器实例
 */
export const DefaultLoopDetector = LoopDetector;
