/**
 * @file optimization-learner.ts - 优化历史学习器 (Phase 5.3 新增)
 * @description
 *   Self-Optimization 子系统的核心组件之一。读取 OPTIMIZATION_LOG.md 历史数据，
 *   统计各模板/类型的成功率、平均耗时、失败原因分布，输出 LearningInsight，
 *   供 ProposalEngine 动态调整风险等级和执行策略。
 *
 *   工作流程：
 *   1. 解析 OPTIMIZATION_LOG.md 中的 JSON 记录
 *   2. 按提案类型/目标/风险等级分组统计
 *   3. 计算成功率、平均耗时、失败原因分布
 *   4. 输出 LearningInsight 列表
 *
 *   设计原则
 *   - 数据驱动：基于历史成功率，而非主观判断
 *   - 时间衰减：近期的数据权重更高
 *   - 最小样本：样本数 < 3 时不下结论
 *   - 供 autoOptimize() 使用：动态调整执行策略
 *
 * @module core/self-opt/optimization-learner
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  OptimizationLogEntry,
  OptimizationResult,
  RiskLevel,
  OptimizationType,
} from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 学习洞察
 */
export interface LearningInsight {
  /** 洞察类型 */
  type: InsightType;
  /** 针对的提案目标/类型 */
  target: string;
  /** 洞察描述（人类可读） */
  description: string;
  /** 建议操作 */
  action: InsightAction;
  /** 数据支持（样本数、成功率等） */
  evidence: Evidence;
  /** 时间范围 */
  timeRange: string;
}

export type InsightType =
  | 'high-success'       // 高成功率，建议自动执行
  | 'low-success'        // 低成功率，建议提升风险等级或禁用
  | 'frequent-failure'   // 反复失败的特定模式
  | 'time-cost'          // 耗时异常
  | 'improving'          // 趋势变好
  | 'degrading';         // 趋势变差

export type InsightAction =
  | 'auto-execute'       // 自动执行
  | 'require-confirm'    // 需要人工确认
  | 'disable-template'   // 暂时禁用模板
  | 'keep-current'       // 保持现状
  | 'investigate';       // 需要人工调查

export interface Evidence {
  /** 样本总数 */
  sampleCount: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failedCount: number;
  /** 成功率 (0-1) */
  successRate: number;
  /** 平均耗时（秒） */
  avgDuration: number;
  /** 中位数耗时（秒） */
  medianDuration: number;
  /** 最常见的失败原因 */
  topFailureReason?: string;
}

/**
 * 模板统计
 */
export interface TemplateStats {
  /** 提案目标/类型 */
  target: string;
  /** 提案类型 */
  proposalType: OptimizationType;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 统计 */
  evidence: Evidence;
  /** 原始记录 */
  entries: OptimizationLogEntry[];
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 解析 OPTIMIZATION_LOG.md 中的历史优化记录
 */
export function parseOptimizationLog(
  projectRoot: string
): OptimizationLogEntry[] {
  const logPath = path.join(projectRoot, 'OPTIMIZATION_LOG.md');
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries: OptimizationLogEntry[] = [];

    // 匹配 ```json ... ``` 代码块
    const jsonBlocks = content.match(/```json\n([\s\S]*?)\n```/g) || [];
    for (const block of jsonBlocks) {
      try {
        const json = block.replace(/^```json\n/, '').replace(/\n```$/, '');
        const entry = JSON.parse(json) as OptimizationLogEntry;
        if (entry.result && entry.proposal) {
          entries.push(entry);
        }
      } catch { /* skip malformed */ }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * 按目标分组统计
 */
function groupByTarget(
  entries: OptimizationLogEntry[]
): Map<string, OptimizationLogEntry[]> {
  const groups = new Map<string, OptimizationLogEntry[]>();
  for (const e of entries) {
    const target = e.proposal.target || 'unknown';
    const list = groups.get(target) || [];
    list.push(e);
    groups.set(target, list);
  }
  return groups;
}

/**
 * 按提案类型分组
 */
function groupByType(
  entries: OptimizationLogEntry[]
): Map<string, OptimizationLogEntry[]> {
  const groups = new Map<string, OptimizationLogEntry[]>();
  for (const e of entries) {
    const t = e.proposal.type || 'unknown';
    const list = groups.get(t) || [];
    list.push(e);
    groups.set(t, list);
  }
  return groups;
}

/**
 * 计算统计指标
 */
function computeEvidence(entries: OptimizationLogEntry[]): Evidence {
  const total = entries.length;
  const successCount = entries.filter(
    (e) => e.result.status === 'success'
  ).length;
  const failedCount = total - successCount;
  const successRate = total > 0 ? successCount / total : 0;

  const durations = entries.map((e) => e.result.totalDurationSeconds || 0);
  const sorted = durations.slice().sort((a, b) => a - b);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const medianDuration = sorted.length > 0
    ? sorted[Math.floor(sorted.length / 2)] : 0;

  // 最常见的失败原因
  let topFailureReason: string | undefined;
  const failedEntries = entries.filter((e) => e.result.status === 'failed');
  if (failedEntries.length > 0) {
    const reasons = new Map<string, number>();
    for (const e of failedEntries) {
      const reason = e.result.lesson || 'unknown';
      reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    let maxCount = 0;
    for (const [reason, count] of reasons) {
      if (count > maxCount) {
        maxCount = count;
        topFailureReason = reason;
      }
    }
  }

  return {
    sampleCount: total,
    successCount,
    failedCount,
    successRate: Math.round(successRate * 100) / 100,
    avgDuration: Math.round(avgDuration * 10) / 10,
    medianDuration: Math.round(medianDuration * 10) / 10,
    topFailureReason,
  };
}

/**
 * 时间范围字符串
 */
function timeRange(entries: OptimizationLogEntry[]): string {
  if (entries.length === 0) return 'N/A';
  const timestamps = entries
    .map((e) => e.result.timestamp || '')
    .filter(Boolean)
    .sort();
  if (timestamps.length === 0) return 'N/A';
  return timestamps[0].slice(0, 10) + ' ~ ' + timestamps[timestamps.length - 1].slice(0, 10);
}

/**
 * 时间衰减权重：越近的数据权重越高
 * @param timestamp ISO 时间戳
 * @param now 当前时间（可选）
 * @returns 权重 (0-1)
 */
function timeDecayWeight(timestamp: string, now?: Date): number {
  const t = new Date(timestamp).getTime();
  const n = (now || new Date()).getTime();
  const daysAgo = (n - t) / (1000 * 60 * 60 * 24);
  // 指数衰减：7 天半衰期
  return Math.pow(0.5, daysAgo / 7);
}

/**
 * 计算加权成功率
 */
function weightedSuccessRate(entries: OptimizationLogEntry[]): number {
  if (entries.length === 0) return 0;
  let totalWeight = 0;
  let successWeight = 0;
  for (const e of entries) {
    const w = timeDecayWeight(e.result.timestamp || '');
    totalWeight += w;
    if (e.result.status === 'success') successWeight += w;
  }
  return totalWeight > 0 ? successWeight / totalWeight : 0;
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 学习结果
 */
export interface LearningResult {
  /** 学习时间 */
  timestamp: string;
  /** 总记录数 */
  totalEntries: number;
  /** 各目标统计 */
  templateStats: TemplateStats[];
  /** 学习洞察 */
  insights: LearningInsight[];
  /** 总体统计 */
  overallEvidence: Evidence;
  /** 摘要 */
  summary: string;
}

/**
 * 学习配置
 */
export interface LearnerConfig {
  /** 最小样本数（低于此值不下结论） */
  minSample: number;
  /** 高成功率阈值（建议自动执行） */
  highSuccessThreshold: number;
  /** 低成功率阈值（建议禁用或提升风险） */
  lowSuccessThreshold: number;
  /** 时间衰减半衰期（天） */
  halfLifeDays: number;
}

const DEFAULT_CONFIG: LearnerConfig = {
  minSample: 3,
  highSuccessThreshold: 0.8,
  lowSuccessThreshold: 0.3,
  halfLifeDays: 7,
};

/**
 * 分析优化历史，输出学习洞察
 *
 * @param projectRoot 项目根目录（包含 OPTIMIZATION_LOG.md）
 * @param config 学习配置（可选，使用默认值）
 * @returns 学习结果
 *
 * @example
 * ```ts
 * const result = await learnFromHistory('/path/to/mini-agent');
 * console.log(`总记录: ${result.totalEntries}，洞察: ${result.insights.length} 条`);
 * for (const i of result.insights) {
 *   console.log(`  [${i.type}] ${i.description} → ${i.action}`);
 * }
 * ```
 */
export async function learnFromHistory(
  projectRoot: string,
  config?: Partial<LearnerConfig>
): Promise<LearningResult> {
  const cfg: LearnerConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const entries = parseOptimizationLog(projectRoot);

  if (entries.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      totalEntries: 0,
      templateStats: [],
      insights: [],
      overallEvidence: {
        sampleCount: 0, successCount: 0, failedCount: 0,
        successRate: 0, avgDuration: 0, medianDuration: 0,
      },
      summary: '无历史优化记录，无法生成洞察',
    };
  }

  // 按目标分组
  const groups = groupByTarget(entries);
  const templateStats: TemplateStats[] = [];

  for (const [target, groupEntries] of groups) {
    const firstEntry = groupEntries[0];
    const evidence = computeEvidence(groupEntries);

    templateStats.push({
      target,
      proposalType: firstEntry.proposal.type,
      riskLevel: firstEntry.proposal.riskLevel,
      evidence,
      entries: groupEntries,
    });
  }

  // 按成功率排序
  templateStats.sort((a, b) => b.evidence.successRate - a.evidence.successRate);

  // 生成洞察
  const insights: LearningInsight[] = [];
  const tr = timeRange(entries);

  // 按类型聚合统计
  const typeGroups = groupByType(entries);
  for (const [type, typeEntries] of typeGroups) {
    const wsr = weightedSuccessRate(typeEntries);
    const ev = computeEvidence(typeEntries);

    if (ev.sampleCount < cfg.minSample) continue;

    if (wsr >= cfg.highSuccessThreshold) {
      insights.push({
        type: 'high-success',
        target: '类型: ' + type,
        description: '提案类型 "' + type + '" 加权成功率 ' + Math.round(wsr * 100) + '%（' + ev.sampleCount + ' 次）',
        action: 'auto-execute',
        evidence: { ...ev, successRate: Math.round(wsr * 100) / 100 },
        timeRange: tr,
      });
    } else if (wsr <= cfg.lowSuccessThreshold) {
      insights.push({
        type: 'low-success',
        target: '类型: ' + type,
        description: '提案类型 "' + type + '" 加权成功率仅 ' + Math.round(wsr * 100) + '%',
        action: 'require-confirm',
        evidence: { ...ev, successRate: Math.round(wsr * 100) / 100 },
        timeRange: tr,
      });
    }
  }

  // 逐个目标的洞察
  for (const ts of templateStats) {
    if (ts.evidence.sampleCount < cfg.minSample) continue;

    // 高成功率 → 自动执行
    if (ts.evidence.successRate >= cfg.highSuccessThreshold) {
      insights.push({
        type: 'high-success',
        target: ts.target,
        description: '"' + ts.target + '" 成功率 ' + Math.round(ts.evidence.successRate * 100) + '%，建议自动执行',
        action: 'auto-execute',
        evidence: ts.evidence,
        timeRange: timeRange(ts.entries),
      });
    }
    // 低成功率 → 提升风险等级
    else if (ts.evidence.successRate <= cfg.lowSuccessThreshold) {
      insights.push({
        type: 'low-success',
        target: ts.target,
        description: '"' + ts.target + '" 成功率仅 ' + Math.round(ts.evidence.successRate * 100) + '%，建议提升风险等级或人工审查',
        action: 'require-confirm',
        evidence: ts.evidence,
        timeRange: timeRange(ts.entries),
      });
    }

    // 反复失败的模式
    if (ts.evidence.failedCount >= 3 && ts.evidence.topFailureReason) {
      insights.push({
        type: 'frequent-failure',
        target: ts.target,
        description: '"' + ts.target + '" 失败 ' + ts.evidence.failedCount + ' 次，常见原因: ' + ts.evidence.topFailureReason.slice(0, 80),
        action: 'investigate',
        evidence: ts.evidence,
        timeRange: timeRange(ts.entries),
      });
    }

    // 耗时异常
    if (ts.evidence.avgDuration > 60) {
      insights.push({
        type: 'time-cost',
        target: ts.target,
        description: '"' + ts.target + '" 平均耗时 ' + ts.evidence.avgDuration + 's，超过 60s 阈值',
        action: 'investigate',
        evidence: ts.evidence,
        timeRange: timeRange(ts.entries),
      });
    }
  }

  // 总体统计
  const overallEvidence = computeEvidence(entries);
  const overallWsr = weightedSuccessRate(entries);

  const summary =
    '共 ' + entries.length + ' 条优化记录，' + templateStats.length + ' 种目标类型。' +
    '总体成功率 ' + Math.round(overallEvidence.successRate * 100) + '%（加权 ' + Math.round(overallWsr * 100) + '%），' +
    '平均耗时 ' + overallEvidence.avgDuration + 's。' +
    '生成 ' + insights.length + ' 条洞察。';

  return {
    timestamp: new Date().toISOString(),
    totalEntries: entries.length,
    templateStats,
    insights,
    overallEvidence,
    summary,
  };
}

/**
 * 格式化学习结果（供 CLI 展示）
 */
export function formatLearningResult(result: LearningResult): string {
  const lines = [
    '══════════════════════════════════════════',
    '📊 Optimization Learning Insights',
    '══════════════════════════════════════════',
    '总记录: ' + result.totalEntries + ' 条',
    '总体成功率: ' + Math.round(result.overallEvidence.successRate * 100) + '%',
    '平均耗时: ' + result.overallEvidence.avgDuration + 's',
    '洞察数: ' + result.insights.length + ' 条',
    '',
  ];

  for (let i = 0; i < result.insights.length; i++) {
    const ins = result.insights[i];
    const icon =
      ins.type === 'high-success' ? '🟢'
        : ins.type === 'low-success' ? '🔴'
          : ins.type === 'frequent-failure' ? '⚠️'
            : ins.type === 'time-cost' ? '⏱️'
              : '📈';

    lines.push(icon + ' [' + (i + 1) + '] ' + ins.description);
    lines.push('     建议: ' + ins.action);
    lines.push('     样本: ' + ins.evidence.sampleCount + ' 次 | 成功率: ' + Math.round(ins.evidence.successRate * 100) + '%');
    lines.push('');
  }

  if (result.insights.length === 0) {
    lines.push('（无足够数据生成洞察）');
  }

  return lines.join('\n');
}
