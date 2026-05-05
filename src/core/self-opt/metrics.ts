/**
 * @file metrics.ts — 优化指标仪表盘 (Phase 5.5 新增)
 * @description
 *   Self-Optimization 子系统的可观测性组件。
 *
 *   功能：
 *   1. 从 OPTIMIZATION_LOG.md 和结构化 JSON 日志聚合数据
 *   2. 计算核心指标：总优化次数、成功率、平均耗时
 *   3. 各模板成功率排名
 *   4. 最近 7 天趋势
 *   5. 当前 painPoints 热力图
 *   6. CLI 命令 `.optimize status` 展示仪表盘
 *
 *   设计原则：
 *   - 向后兼容：同时读取旧格式（OPTIMIZATION_LOG.md）和新格式（JSONL）
 *   - 轻量：纯计算，不依赖外部服务
 *   - 可扩展：指标函数独立，可被其他模块调用
 *
 * @module core/self-opt/metrics
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  OptimizationLogEntry,
  InspectionReport,
  RiskLevel,
  OptimizationType,
} from './types.js';
import { loadOptimizationLog } from './auto-optimizer.js';
import { readStructuredLog } from './structured-logger.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 总体指标
 */
export interface OverallMetrics {
  /** 总优化次数 */
  totalOptimizations: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failedCount: number;
  /** 回滚次数 */
  revertedCount: number;
  /** 跳过次数 */
  skippedCount: number;
  /** 成功率 (0-1) */
  successRate: number;
  /** 平均耗时（秒） */
  avgDurationSeconds: number;
  /** 中位数耗时（秒） */
  medianDurationSeconds: number;
  /** 最近一次优化时间 */
  lastOptimization?: string;
}

/**
 * 模板排名项
 */
export interface TemplateRanking {
  /** 模板目标/名称 */
  target: string;
  /** 提案类型 */
  proposalType: OptimizationType;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 执行次数 */
  count: number;
  /** 成功次数 */
  successCount: number;
  /** 成功率 */
  successRate: number;
  /** 平均耗时（秒） */
  avgDuration: number;
}

/**
 * 趋势数据点（按天聚合）
 */
export interface TrendDataPoint {
  /** 日期 (YYYY-MM-DD) */
  date: string;
  /** 当日优化次数 */
  count: number;
  /** 当日成功次数 */
  successCount: number;
  /** 当日成功率 */
  successRate: number;
  /** 当日平均耗时（秒） */
  avgDuration: number;
}

/**
 * PainPoint 热度项
 */
export interface PainPointHeatItem {
  /** 痛点描述 */
  description: string;
  /** 出现次数 */
  frequency: number;
  /** 关联的优化提案 ID */
  relatedProposalIds: string[];
  /** 是否已解决 */
  resolved: boolean;
}

/**
 * 仪表盘汇总
 */
export interface DashboardResult {
  /** 生成时间 */
  timestamp: string;
  /** 总体指标 */
  overall: OverallMetrics;
  /** 模板排名（按成功率降序） */
  templateRanking: TemplateRanking[];
  /** 最近 7 天趋势 */
  trend7d: TrendDataPoint[];
  /** PainPoint 热力图 */
  painPointHeat: PainPointHeatItem[];
  /** 摘要文本 */
  summary: string;
}

// ============================================================================
// 工具函数：日志合并
// ============================================================================

/**
 * 合并两种日志源（旧格式 + 新格式），去重
 *
 * 本函数解决了 Phase 5.5 过渡期的双源数据问题：
 * - 旧格式：OPTIMIZATION_LOG.md 中的 JSON 代码块（Phase 5.1~5.4 使用）
 * - 新格式：logs/optimization.jsonl 纯 JSONL 文件（Phase 5.5+ 使用）
 *
 * 去重策略：基于 proposal.id 判重，优先使用新格式的记录
 *（新格式信息更完整，包含结构化事件类型）
 *
 * @param projectRoot 项目根目录
 * @returns 去重后的合并日志条目列表
 *
 * @example
 * ```ts
 * const allEntries = mergeAllEntries('/path/to/mini-agent');
 * console.log(`共 ${allEntries.length} 条优化记录`);
 * ```
 */
function mergeAllEntries(projectRoot: string): OptimizationLogEntry[] {
  const legacyEntries = loadOptimizationLog(projectRoot);
  const structuredEntries = readStructuredLog(projectRoot);
  // 去重：基于 proposal.id
  const seen = new Set<string>();
  const merged: OptimizationLogEntry[] = [];
  for (const e of [...structuredEntries, ...legacyEntries]) {
    const id = e.proposal?.id || e.result?.proposalId || '';
    if (id && !seen.has(id)) {
      seen.add(id);
      merged.push(e);
    }
  }
  return merged;
}

/**
 * 计算总体指标
 *
 * 从合并后的日志条目中计算以下指标：
 * - 总优化次数、成功/失败/回滚/跳过次数
 * - 成功率（保留 3 位小数，如 0.857）
 * - 平均耗时和中位数耗时（秒）
 * - 最近一次优化时间（ISO 8601）
 *
 * 注意：
 * - 空输入返回全零指标，不抛异常
 * - 耗时统计排除 duration = 0 的记录（未记录耗时的条目）
 * - 中位数使用排序后取中间值，非精确中位数（偶数时取偏小值）
 *
 * @param entries 优化日志条目列表
 * @returns 总体指标对象
 *
 * @example
 * ```ts
 * const entries = loadLogEntries(projectRoot);
 * const metrics = computeOverallMetrics(entries);
 * if (metrics.successRate < 0.5) {
 *   console.log('⚠️ 成功率低于 50%，建议检查优化流程');
 * }
 * ```
 */
export function computeOverallMetrics(entries: OptimizationLogEntry[]): OverallMetrics {
  const total = entries.length;
  if (total === 0) {
    return {
      totalOptimizations: 0,
      successCount: 0,
      failedCount: 0,
      revertedCount: 0,
      skippedCount: 0,
      successRate: 0,
      avgDurationSeconds: 0,
      medianDurationSeconds: 0,
    };
  }

  const successCount = entries.filter(e => e.result?.status === 'success').length;
  const failedCount = entries.filter(e => e.result?.status === 'failed').length;
  const revertedCount = entries.filter(e => e.result?.reverted === true).length;
  const skippedCount = entries.filter(e => e.result?.status === 'skipped').length;
  const successRate = total > 0 ? successCount / total : 0;

  const durations = entries
    .map(e => e.result?.totalDurationSeconds || 0)
    .filter(d => d > 0);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const sorted = durations.slice().sort((a, b) => a - b);
  const medianDuration = sorted.length > 0
    ? sorted[Math.floor(sorted.length / 2)] : 0;

  // 最近一次优化时间
  const timestamps = entries
    .map(e => e.result?.timestamp || '')
    .filter(Boolean)
    .sort()
    .reverse();
  const lastOptimization = timestamps.length > 0 ? timestamps[0] : undefined;

  return {
    totalOptimizations: total,
    successCount,
    failedCount,
    revertedCount,
    skippedCount,
    successRate: Math.round(successRate * 1000) / 1000,
    avgDurationSeconds: Math.round(avgDuration * 10) / 10,
    medianDurationSeconds: Math.round(medianDuration * 10) / 10,
    lastOptimization,
  };
}

/**
 * 计算模板排名（按成功率降序）
 *
 * 将日志条目按提案目标（target）分组，计算每个模板的：
 * - 执行次数、成功次数、成功率
 * - 平均耗时
 *
 * 排序规则：
 * 1. 成功率降序（主要排序）
 * 2. 执行次数降序（次要排序，成功率相同时）
 *
 * 用途：
 * - 识别高成功率的模板，可降为 low risk 实现自动执行
 * - 识别低成功率的模板，需提升风险等级或改进算法
 * - 供 optimization-learner.ts 的 LearningInsight 生成使用
 *
 * @param entries 优化日志条目列表
 * @returns 模板排名列表（成功率从高到低）
 *
 * @example
 * ```ts
 * const ranking = computeTemplateRanking(entries);
 * console.log('最佳模板:', ranking[0].target);
 * console.log('最差模板:', ranking[ranking.length - 1].target);
 * ```
 */
export function computeTemplateRanking(
  entries: OptimizationLogEntry[]
): TemplateRanking[] {
  const groups = new Map<string, OptimizationLogEntry[]>();
  for (const e of entries) {
    const target = e.proposal?.target || 'unknown';
    const list = groups.get(target) || [];
    list.push(e);
    groups.set(target, list);
  }

  const rankings: TemplateRanking[] = [];
  for (const [target, groupEntries] of groups) {
    const first = groupEntries[0];
    const count = groupEntries.length;
    const successCount = groupEntries.filter(e => e.result?.status === 'success').length;
    const successRate = count > 0 ? successCount / count : 0;
    const durations = groupEntries
      .map(e => e.result?.totalDurationSeconds || 0)
      .filter(d => d > 0);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    rankings.push({
      target,
      proposalType: first.proposal?.type || 'add',
      riskLevel: first.proposal?.riskLevel || 'low',
      count,
      successCount,
      successRate: Math.round(successRate * 1000) / 1000,
      avgDuration: Math.round(avgDuration * 10) / 10,
    });
  }

  // 按成功率降序，其次按次数降序
  rankings.sort((a, b) => {
    if (b.successRate !== a.successRate) return b.successRate - a.successRate;
    return b.count - a.count;
  });

  return rankings;
}

/**
 * 计算最近 N 天趋势（默认 7 天）
 *
 * 按天聚合优化数据，生成时间序列。包含：
 * - 每日优化次数、成功次数、成功率、平均耗时
 *
 * 设计细节：
 * - 预初始化 N 天空数据（日期连续，即使某天无优化）
 * - 只统计最近 N 天的数据，更早的记录被忽略
 * - 无优化的日期 count = 0，successRate = 0
 * - 使用 ISO 日期前 10 位（YYYY-MM-DD）作为天键
 *
 * 用途：
 * - 判断优化成功率是否呈上升趋势
 * - 识别某天的异常失败（如大量优化同时失败）
 * - 生成趋势图表（供前端/可视化使用）
 *
 * @param entries 优化日志条目列表
 * @param days 天数（默认 7）
 * @returns 趋势数据点列表（按日期升序）
 *
 * @example
 * ```ts
 * const trend = computeTrend(entries, 7);
 * const improving = trend[trend.length - 1].successRate > trend[0].successRate;
 * console.log(improving ? '趋势向好 ↑' : '趋势下降 ↓');
 * ```
 */
export function computeTrend(
  entries: OptimizationLogEntry[],
  days: number = 7
): TrendDataPoint[] {
  const now = new Date();
  const dailyMap = new Map<string, OptimizationLogEntry[]>();

  // 初始化最近 N 天的空数据
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, []);
  }

  // 填充数据
  for (const e of entries) {
    const ts = e.result?.timestamp || '';
    if (!ts) continue;
    const key = ts.slice(0, 10);
    if (dailyMap.has(key)) {
      dailyMap.get(key)!.push(e);
    }
  }

  const trend: TrendDataPoint[] = [];
  for (const [date, dayEntries] of dailyMap) {
    const count = dayEntries.length;
    const successCount = dayEntries.filter(e => e.result?.status === 'success').length;
    const successRate = count > 0 ? successCount / count : 0;
    const durations = dayEntries
      .map(e => e.result?.totalDurationSeconds || 0)
      .filter(d => d > 0);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    trend.push({
      date,
      count,
      successCount,
      successRate: Math.round(successRate * 1000) / 1000,
      avgDuration: Math.round(avgDuration * 10) / 10,
    });
  }

  return trend;
}

/**
 * 计算 PainPoint 热力图
 *
 * 综合两个数据源，识别代码中的高频痛点：
 *
 * 1. **历史失败记录**：从优化日志中提取失败条目的 lesson 字段，
 *    统计每个痛点的出现频率、关联的提案 ID、是否已被成功修复
 *
 * 2. **当前检查报告**：从最新的 InspectionReport 中注入当前存在的痛点，
 *    即使历史中未出现过（新增痛点也能被追踪）
 *
 * 痛点解决判定：
 * - 当某目标的优化状态为 'success' 时，标记对应痛点为 resolved = true
 * - 注意：resolved 不保证永久解决，后续可能重新出现
 *
 * 排序：按出现频率降序
 *
 * 用途：
 * - 仪表盘展示高频痛点
 * - 指导优化优先级（高频痛点优先生成提案）
 * - 追踪痛点解决进度
 *
 * @param entries 优化日志条目列表
 * @param currentReport 当前检查报告（可选，注入最新痛点）
 * @returns PainPoint 热度项列表（按频率降序）
 *
 * @example
 * ```ts
 * const heat = computePainPointHeat(entries, inspectionReport);
 * const unresolved = heat.filter(h => !h.resolved);
 * console.log(`待解决痛点: ${unresolved.length} 个`);
 * ```
 */
export function computePainPointHeat(
  entries: OptimizationLogEntry[],
  currentReport?: InspectionReport
): PainPointHeatItem[] {
  const heatMap = new Map<string, PainPointHeatItem>();

  // 从优化历史中提取痛点
  for (const e of entries) {
    // 失败记录的 lesson 视为痛点
    if (e.result?.status === 'failed' && e.result.lesson) {
      const key = e.result.lesson.slice(0, 100);
      if (!heatMap.has(key)) {
        heatMap.set(key, {
          description: key,
          frequency: 0,
          relatedProposalIds: [],
          resolved: false,
        });
      }
      const item = heatMap.get(key)!;
      item.frequency++;
      if (e.proposal?.id && !item.relatedProposalIds.includes(e.proposal.id)) {
        item.relatedProposalIds.push(e.proposal.id);
      }
    }

    // 成功修复的目标视为已解决的痛点
    if (e.result?.status === 'success' && e.proposal?.target) {
      const key = e.proposal.target;
      if (heatMap.has(key)) {
        heatMap.get(key)!.resolved = true;
      }
    }
  }

  // 从当前检查报告中注入 painPoints
  if (currentReport) {
    for (const pp of currentReport.painPoints) {
      const key = pp.description;
      if (!heatMap.has(key)) {
        heatMap.set(key, {
          description: key,
          frequency: 1,
          relatedProposalIds: [],
          resolved: false,
        });
      }
    }
  }

  // 按频率降序
  return Array.from(heatMap.values())
    .sort((a, b) => b.frequency - a.frequency);
}

// ============================================================================
// 主入口：生成完整仪表盘
// ============================================================================

/**
 * 生成优化仪表盘
 *
 * @param projectRoot 项目根目录
 * @param currentReport 当前检查报告（可选，用于注入 painPoints）
 * @returns 仪表盘结果
 *
 * @example
 * ```ts
 * const dashboard = await generateDashboard(projectRoot, inspectionReport);
 * console.log(dashboard.summary);
 * ```
 */
export async function generateDashboard(
  projectRoot: string,
  currentReport?: InspectionReport
): Promise<DashboardResult> {
  const entries = mergeAllEntries(projectRoot);

  const overall = computeOverallMetrics(entries);
  const templateRanking = computeTemplateRanking(entries);
  const trend7d = computeTrend(entries, 7);
  const painPointHeat = computePainPointHeat(entries, currentReport);

  // 生成摘要
  let summary = `共 ${overall.totalOptimizations} 次优化，`;
  summary += `成功率 ${Math.round(overall.successRate * 100)}%，`;
  summary += `平均耗时 ${overall.avgDurationSeconds}s`;

  if (overall.revertedCount > 0) {
    summary += `，${overall.revertedCount} 次回滚`;
  }

  // 趋势判断
  const recent3 = trend7d.slice(-3).filter(d => d.count > 0);
  if (recent3.length >= 2) {
    const improving = recent3[recent3.length - 1].successRate > recent3[0].successRate;
    summary += improving ? '，趋势向好 ↑' : '，趋势有待改善 ↓';
  }

  if (overall.lastOptimization) {
    summary += `\n最近一次: ${overall.lastOptimization.slice(0, 16)}`;
  }

  return {
    timestamp: new Date().toISOString(),
    overall,
    templateRanking,
    trend7d,
    painPointHeat,
    summary,
  };
}

/**
 * 格式化仪表盘（供 CLI 展示）
 */
export function formatDashboard(d: DashboardResult): string {
  const lines = [
    '═══════════════════════════════════════════════════',
    '📊 Self-Optimization Dashboard',
    '═══════════════════════════════════════════════════',
    '',
    '── 总体指标 ──',
    `  总优化次数: ${d.overall.totalOptimizations}`,
    `  ✅ 成功: ${d.overall.successCount}  |  ❌ 失败: ${d.overall.failedCount}  |  🔄 回滚: ${d.overall.revertedCount}`,
    `  成功率: ${Math.round(d.overall.successRate * 100)}%`,
    `  平均耗时: ${d.overall.avgDurationSeconds}s  |  中位数: ${d.overall.medianDurationSeconds}s`,
    d.overall.lastOptimization
      ? `  最近一次: ${d.overall.lastOptimization.slice(0, 19)}`
      : '  最近一次: 无记录',
    '',
    d.summary,
    '',
  ];

  // 模板排名
  lines.push('── 模板排名（按成功率） ──');
  if (d.templateRanking.length === 0) {
    lines.push('  （无数据）');
  } else {
    for (let i = 0; i < Math.min(d.templateRanking.length, 10); i++) {
      const r = d.templateRanking[i];
      const bar = '█'.repeat(Math.round(r.successRate * 10));
      const icon = r.successRate >= 0.8 ? '🟢' : r.successRate >= 0.5 ? '🟡' : '🔴';
      lines.push(
        `  ${i + 1}. ${icon} ${r.target}`
      );
      lines.push(
        `     ${bar.padEnd(11)} ${Math.round(r.successRate * 100)}% (${r.successCount}/${r.count})  平均 ${r.avgDuration}s`
      );
    }
    if (d.templateRanking.length > 10) {
      lines.push(`  ... 还有 ${d.templateRanking.length - 10} 个`);
    }
  }

  lines.push('');

  // 7 天趋势
  lines.push('── 最近 7 天趋势 ──');
  const activeDays = d.trend7d.filter(d => d.count > 0);
  if (activeDays.length === 0) {
    lines.push('  （最近 7 天无优化记录）');
  } else {
    for (const dp of d.trend7d) {
      if (dp.count === 0) {
        lines.push(`  ${dp.date}: —`);
      } else {
        const icon = dp.successRate >= 0.8 ? '✅' : dp.successRate >= 0.5 ? '⚠️' : '❌';
        lines.push(
          `  ${dp.date}: ${icon} ${dp.count}次, 成功率 ${Math.round(dp.successRate * 100)}%, 均时 ${dp.avgDuration}s`
        );
      }
    }
  }

  lines.push('');

  // PainPoint 热力图
  lines.push('── PainPoint 热力图 ──');
  if (d.painPointHeat.length === 0) {
    lines.push('  （无痛点记录）');
  } else {
    for (let i = 0; i < Math.min(d.painPointHeat.length, 8); i++) {
      const h = d.painPointHeat[i];
      const icon = h.resolved ? '✅' : h.frequency >= 3 ? '🔴' : '🟡';
      const freq = '⚡'.repeat(Math.min(h.frequency, 5));
      lines.push(`  ${icon} ${h.description}`);
      lines.push(`     ${freq} 出现 ${h.frequency} 次${h.resolved ? ' (已解决)' : ''}`);
    }
    if (d.painPointHeat.length > 8) {
      lines.push(`  ... 还有 ${d.painPointHeat.length - 8} 个`);
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}
