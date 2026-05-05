/**
 * @file error-analyzer.ts - 错误分析引擎 (Phase 5.2 新增)
 * @description
 *   Self-Optimization 子系统的核心组件之一。读取运行时错误日志，
 *   聚类相同类型错误，按频率排序，生成可对接优化提案的错误分析报告。
 *
 *   工作流程：
 *   1. 读取 errors/error-log.jsonl 日志文件
 *   2. 按 stackHash 聚类相同错误，统计频率
 *   3. 按频率排序，优先分析高频错误
 *   4. 生成 ErrorAnalysis 报告，可对接 generateProposals()
 *
 *   设计原则
 *   - 频率优先：出现越多次的错误，优先级越高
 *   - 自动分类：将错误归类为 crash / type-error / runtime / performance
 *   - 可行动性：每个错误簇都附带修复建议
 *   - 与 Inspector 对接：运行时错误 > 静态分析
 *
 * @module core/self-opt/error-analyzer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RuntimeErrorRecord, ErrorContext } from './runtime-error-collector.js';
import type { InspectionReport, PainPoint } from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 错误簇：相同 stackHash 的错误集合
 */
export interface ErrorCluster {
  /** 堆栈哈希 */
  stackHash: string;
  /** 错误类型 */
  errorType: string;
  /** 错误消息（取最新一条） */
  latestMessage: string;
  /** 堆栈（取最新一条） */
  latestStack: string;
  /** 出现次数 */
  count: number;
  /** 首次出现时间 */
  firstSeen: string;
  /** 最后出现时间 */
  lastSeen: string;
  /** 涉及的工具/模块 */
  tools: string[];
  /** 所有上下文 */
  contexts: ErrorContext[];
  /** 错误分类 */
  category: ErrorCategory;
  /** 修复建议 */
  suggestion: string;
  /** 严重程度 (1-5) */
  severity: number;
}

/**
 * 错误分类
 */
export type ErrorCategory =
  | 'crash'           // 程序崩溃
  | 'type-error'      // TypeScript 类型错误（运行时）
  | 'runtime'         // 运行时错误（文件不存在、网络失败等）
  | 'performance'     // 性能相关（超时、内存）
  | 'logic'           // 逻辑错误
  | 'unknown';        // 未知

// ============================================================================
// 错误分类规则
// ============================================================================

/**
 * 根据错误类型和消息判断错误分类
 */
function classifyError(errorType: string, message: string): ErrorCategory {
  const type = errorType.toLowerCase();
  const msg = message.toLowerCase();

  if (type.includes('typeerror') || msg.includes('undefined') || msg.includes('null') || msg.includes('not a function')) {
    return 'type-error';
  }
  if (type.includes('timeout') || msg.includes('timeout') || msg.includes('memory') || msg.includes('heap')) {
    return 'performance';
  }
  if (type.includes('error') && (msg.includes('crash') || msg.includes('fatal') || msg.includes('uncaught'))) {
    return 'crash';
  }
  if (type.includes('rangeerror') || type.includes('syntaxerror') || type.includes('referenceerror')) {
    return 'runtime';
  }
  if (msg.includes('not found') || msg.includes('no such') || msg.includes('eperm') || msg.includes('eacces')) {
    return 'runtime';
  }
  if (msg.includes('expected') || msg.includes('invalid') || msg.includes('assertion')) {
    return 'logic';
  }
  return 'unknown';
}

/**
 * 根据错误分类生成修复建议
 */
function generateSuggestion(cluster: ErrorCluster): string {
  switch (cluster.category) {
    case 'crash':
      return '程序崩溃，需要添加 try-catch 保护或修复根本原因';
    case 'type-error':
      return '类型错误，检查变量是否为 undefined/null，添加类型守卫';
    case 'runtime':
      return '运行时错误，检查文件路径、权限、网络连接等外部依赖';
    case 'performance':
      return '性能问题，考虑增加超时时间、优化算法或增加内存限制';
    case 'logic':
      return '逻辑错误，检查条件判断和边界情况';
    default:
      return '未知错误，需要人工分析堆栈追踪';
  }
}

/**
 * 根据错误分类和频率计算严重程度 (1-5)
 */
function calculateSeverity(category: ErrorCategory, count: number): number {
  let base = 2;
  if (category === 'crash') base = 4;
  else if (category === 'type-error') base = 3;
  else if (category === 'performance') base = 3;

  if (count >= 20) base += 1;
  if (count >= 50) base += 1;

  return Math.min(base, 5);
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从 JSONL 日志文件读取错误记录
 */
function readErrorLog(logPath: string): RuntimeErrorRecord[] {
  if (!fs.existsSync(logPath)) return [];
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const records: RuntimeErrorRecord[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * 获取错误日志路径
 */
function getErrorLogPath(errorsDir?: string): string {
  const dir = errorsDir || path.resolve(process.cwd(), 'errors');
  const today = new Date().toISOString().slice(0, 10);
  return path.join(dir, `error-log-${today}.jsonl`);
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 错误分析结果
 */
export interface ErrorAnalysis {
  /** 分析时间 */
  timestamp: string;
  /** 总错误数 */
  totalErrors: number;
  /** 错误簇数量 */
  clusterCount: number;
  /** 错误簇列表（按频率降序） */
  clusters: ErrorCluster[];
  /** 按分类统计 */
  categoryStats: Record<string, number>;
  /** 高频错误（出现 >= 5 次） */
  frequentErrors: ErrorCluster[];
  /** 可转化为优化提案的痛点 */
  painPoints: PainPoint[];
  /** 分析摘要 */
  summary: string;
}

/**
 * 分析运行时错误日志
 *
 * 读取错误日志，聚类相同错误，生成分析报告。
 * 报告可直接对接 Inspector 和 Proposal Engine。
 *
 * @param errorsDir 错误日志目录（默认：项目根目录/errors）
 * @returns 错误分析报告
 *
 * @example
 * ```ts
 * const analysis = await analyzeErrors('./errors');
 * console.log(`共 ${analysis.totalErrors} 个错误，${analysis.clusterCount} 种类型`);
 * console.log(`高频错误: ${analysis.frequentErrors.length} 种`);
 * ```
 */
export async function analyzeErrors(
  errorsDir?: string
): Promise<ErrorAnalysis> {
  const logPath = getErrorLogPath(errorsDir);
  const records = readErrorLog(logPath);

  // 按 stackHash 聚类
  const clusterMap = new Map<string, RuntimeErrorRecord[]>();
  for (const r of records) {
    const existing = clusterMap.get(r.stackHash) || [];
    existing.push(r);
    clusterMap.set(r.stackHash, existing);
  }

  // 构建错误簇
  const clusters: ErrorCluster[] = [];
  for (const [hash, records] of clusterMap) {
    const sorted = records.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const category = classifyError(first.errorType, first.message);
    const tools = [...new Set(
      records.map((r) => r.context.tool).filter(Boolean) as string[]
    )];

    const cluster: ErrorCluster = {
      stackHash: hash,
      errorType: first.errorType,
      latestMessage: last.message,
      latestStack: last.stack,
      count: records.length,
      firstSeen: first.timestamp,
      lastSeen: last.timestamp,
      tools,
      contexts: records.map((r) => r.context),
      category,
      suggestion: '', // 稍后填充
      severity: 0,     // 稍后计算
    };
    cluster.suggestion = generateSuggestion(cluster);
    cluster.severity = calculateSeverity(category, records.length);

    clusters.push(cluster);
  }

  // 按频率降序
  clusters.sort((a, b) => b.count - a.count);

  // 分类统计
  const categoryStats: Record<string, number> = {};
  for (const c of clusters) {
    categoryStats[c.category] = (categoryStats[c.category] || 0) + c.count;
  }

  // 高频错误（>= 5 次）
  const frequentErrors = clusters.filter((c) => c.count >= 5);

  // 转化为痛点
  const painPoints: PainPoint[] = [];
  for (const c of clusters) {
    const toolInfo = c.tools.length > 0 ? ' (工具: ' + c.tools.join(', ') + ')' : '';
    painPoints.push({
      description: `[运行时] ${c.errorType}: ${c.latestMessage.slice(0, 100)}${toolInfo} — 出现 ${c.count} 次`,
      severity: c.severity >= 4 ? 'high' : c.severity >= 3 ? 'medium' : 'low',
      evidence: '运行时错误日志: ' + c.stackHash + ' (' + c.count + ' 次)',
    });
  }

  // 摘要
  const summary =
    '共 ' + records.length + ' 个错误，' + clusters.length + ' 种类型。' +
    '高频错误 (' + frequentErrors.length + ' 种): ' +
    frequentErrors.slice(0, 3).map((c) => c.errorType + ' x' + c.count).join(', ') +
    (frequentErrors.length === 0 ? '无' : '') + '。' +
    '建议优先修复: ' +
    (clusters[0] ? clusters[0].errorType + ' (' + clusters[0].count + ' 次)' : '无错误');

  return {
    timestamp: new Date().toISOString(),
    totalErrors: records.length,
    clusterCount: clusters.length,
    clusters,
    categoryStats,
    frequentErrors,
    painPoints,
    summary,
  };
}

/**
 * 将错误分析报告注入到自检报告中
 *
 * Phase 5.2.3: Inspector 接入运行时数据
 * 运行时错误优先级 > 静态分析
 *
 * @param report 已有的自检报告（会被直接修改）
 * @param errorAnalysis 错误分析报告
 * @returns 注入后的报告
 */
export function injectErrorsIntoInspection(
  report: InspectionReport,
  errorAnalysis: ErrorAnalysis
): InspectionReport {
  // 运行时错误插入到 painPoints 最前面（优先级最高）
  const runtimePainPoints = errorAnalysis.painPoints.map((p) => ({
    ...p,
    severity: p.severity === 'high' ? 'high' as const : p.severity === 'medium' ? 'medium' as const : 'low' as const,
  }));

  report.painPoints = [...runtimePainPoints, ...report.painPoints];

  // 更新建议
  if (errorAnalysis.frequentErrors.length > 0) {
    const topError = errorAnalysis.frequentErrors[0];
    report.suggestions.unshift(
      '修复高频运行时错误: ' + topError.errorType + ' (出现 ' + topError.count + ' 次) — ' + topError.suggestion
    );
  }

  // 更新摘要
  report.summary = '[运行时] ' + errorAnalysis.summary + '。[静态] ' + report.summary;

  return report;
}
