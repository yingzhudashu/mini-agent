/**
 * @file structured-logger.ts — 结构化 JSON 日志 (Phase 5.5 新增)
 * @description
 *   Self-Optimization 子系统的结构化日志组件。
 *
 *   替代旧的 OPTIMIZATION_LOG.md 混合格式，使用纯 JSON Lines 格式：
 *   - 每行一个完整 JSON 对象
 *   - 便于程序解析、可视化、历史对比
 *   - 支持日志轮转（超过 10MB 自动归档）
 *   - 向后兼容：可读取旧格式
 *
 *   日志事件类型：
 *   - optimize_start: 优化流程开始
 *   - optimize_complete: 优化流程完成
 *   - proposal_generated: 提案生成
 *   - proposal_executed: 提案执行
 *   - test_run: 测试执行
 *   - fix_attempted: 修复尝试
 *   - rollback: 回滚
 *   - error: 运行时错误
 *
 *   文件结构：
 *   - 主日志: `logs/optimization.jsonl`
 *   - 归档日志: `logs/optimization.YYYY-MM-DD.jsonl`（轮转时生成）
 *
 * @module core/self-opt/structured-logger
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

/** 日志事件类型 */
export type StructuredLogEventType =
  | 'optimize_start'
  | 'optimize_complete'
  | 'proposal_generated'
  | 'proposal_executed'
  | 'test_run'
  | 'fix_attempted'
  | 'rollback'
  | 'error';

/** 结构化日志条目 */
export interface StructuredLogEntry {
  /** 事件类型 */
  type: StructuredLogEventType;
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 项目版本（如果有） */
  version?: string;
  /** 事件负载（根据 type 不同） */
  payload: Record<string, unknown>;
  /** 可选：关联的提案 ID */
  proposalId?: string;
  /** 可选：关联的测试用例 ID */
  testCaseId?: string;
}

/** 日志配置 */
export interface StructuredLoggerConfig {
  /** 日志目录（相对于 projectRoot） */
  logDir: string;
  /** 日志文件名 */
  logFileName: string;
  /** 最大日志大小（字节），超过时轮转 */
  maxLogSize: number;
}

const DEFAULT_CONFIG: StructuredLoggerConfig = {
  logDir: 'logs',
  logFileName: 'optimization.jsonl',
  maxLogSize: 10 * 1024 * 1024, // 10 MB
};

// ============================================================================
// 工具函数
// ============================================================================

// ============================================================================
// 工具函数：日志目录与文件管理
// ============================================================================

/**
 * 确保日志目录存在
 *
 * 在项目根目录下创建日志目录（默认 `logs/`）。
 * 使用 `fs.mkdirSync` + `recursive: true` 确保中间目录也被创建。
 *
 * @param projectRoot 项目根目录
 * @param logDir 日志目录路径（绝对或相对路径）
 * @returns 日志目录的绝对路径
 */
function ensureLogDir(projectRoot: string, logDir: string): string {
  const fullPath = path.isAbsolute(logDir) ? logDir : path.join(projectRoot, logDir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
  return fullPath;
}

/**
 * 获取日志文件路径
 *
 * 拼接日志目录和文件名，返回完整路径。
 * 默认文件名: `optimization.jsonl`
 *
 * @param projectRoot 项目根目录
 * @param config 日志配置
 * @returns 日志文件的完整路径
 */
function getLogPath(projectRoot: string, config: StructuredLoggerConfig): string {
  const logDir = ensureLogDir(projectRoot, config.logDir);
  return path.join(logDir, config.logFileName);
}

/**
 * 日志轮转：超过最大大小时，归档当前日志
 *
 * 当日志文件超过 maxLogSize（默认 10MB）时：
 * 1. 将当前日志重命名为 `optimization.YYYY-MM-DD.jsonl`
 * 2. 如果同名归档已存在，自动加序号（`.1.jsonl`, `.2.jsonl`, ...）
 * 3. 原日志文件被移除，下次写入时自动创建新文件
 *
 * 注意：
 * - 使用 `fs.renameSync` 原子操作，避免写入中断
 * - 只在追加前检查，不保证写入后不超限（但 10MB 阈值足够大）
 * - 归档文件不会被自动清理，需手动删除
 *
 * @param logPath 日志文件路径
 * @param maxLogSize 最大日志大小（字节）
 */
function rotateLogIfNeeded(logPath: string, maxLogSize: number): void {
  if (!fs.existsSync(logPath)) return;

  const stats = fs.statSync(logPath);
  if (stats.size < maxLogSize) return;

  // 归档为带日期的文件名
  const dir = path.dirname(logPath);
  const base = path.basename(logPath, '.jsonl');
  const date = new Date().toISOString().slice(0, 10);
  const archivePath = path.join(dir, `${base}.${date}.jsonl`);

  // 如果归档文件已存在，加序号
  let finalPath = archivePath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(dir, `${base}.${date}.${counter}.jsonl`);
    counter++;
  }

  fs.renameSync(logPath, finalPath);
}

// ============================================================================
// 写入操作
// ============================================================================

/**
 * 追加一条结构化日志
 *
 * @param projectRoot 项目根目录
 * @param entry 日志条目
 * @param config 日志配置（可选）
 *
 * @example
 * ```ts
 * appendStructuredLog(projectRoot, {
 *   type: 'proposal_executed',
 *   timestamp: new Date().toISOString(),
 *   proposalId: 'prop-123',
 *   payload: { target: '空 catch 块', status: 'success', duration: 3.2 }
 * });
 * ```
 */
export function appendStructuredLog(
  projectRoot: string,
  entry: StructuredLogEntry,
  config?: Partial<StructuredLoggerConfig>
): void {
  const cfg: StructuredLoggerConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const logPath = getLogPath(projectRoot, cfg);

  // 轮转检查
  rotateLogIfNeeded(logPath, cfg.maxLogSize);

  // 追加 JSON 行
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf-8');
}

/**
 * 记录优化流程开始
 *
 * 在 autoOptimize() 入口处调用，记录本次优化的提案数量。
 *
 * @param projectRoot 项目根目录
 * @param proposalCount 本次生成的提案总数
 */
export function logOptimizeStart(
  projectRoot: string,
  proposalCount: number
): void {
  appendStructuredLog(projectRoot, {
    type: 'optimize_start',
    timestamp: new Date().toISOString(),
    payload: { proposalCount },
  });
}

/**
 * 记录优化流程完成
 *
 * 在 autoOptimize() 结束时调用，汇总执行结果。
 *
 * @param projectRoot 项目根目录
 * @param executed 已执行的提案数
 * @param succeeded 成功数
 * @param failed 失败数
 * @param reverted 回滚数
 */
export function logOptimizeComplete(
  projectRoot: string,
  executed: number,
  succeeded: number,
  failed: number,
  reverted: number
): void {
  appendStructuredLog(projectRoot, {
    type: 'optimize_complete',
    timestamp: new Date().toISOString(),
    payload: { executed, succeeded, failed, reverted },
  });
}

/**
 * 记录提案执行结果
 *
 * 在每个提案执行完成后调用，记录详细结果。
 * 包含：状态、耗时、测试汇总、修复次数、回滚状态、经验教训。
 *
 * @param projectRoot 项目根目录
 * @param result 优化执行结果（来自 auto-optimizer.ts）
 */
export function logProposalExecuted(
  projectRoot: string,
  result: OptimizationResult
): void {
  appendStructuredLog(projectRoot, {
    type: 'proposal_executed',
    timestamp: result.timestamp || new Date().toISOString(),
    proposalId: result.proposalId,
    payload: {
      status: result.status,
      totalDurationSeconds: result.totalDurationSeconds,
      fixAttempts: result.fixAttempts,
      reverted: result.reverted,
      testSummary: result.testSummary,
      lesson: result.lesson,
    },
  });
}

/**
 * 记录测试执行
 */
export function logTestRun(
  projectRoot: string,
  testCaseId: string,
  passed: boolean,
  durationMs: number
): void {
  appendStructuredLog(projectRoot, {
    type: 'test_run',
    timestamp: new Date().toISOString(),
    testCaseId,
    payload: { passed, durationMs },
  });
}

/**
 * 记录修复尝试
 */
export function logFixAttempt(
  projectRoot: string,
  proposalId: string,
  attempt: number,
  success: boolean
): void {
  appendStructuredLog(projectRoot, {
    type: 'fix_attempted',
    timestamp: new Date().toISOString(),
    proposalId,
    payload: { attempt, success },
  });
}

/**
 * 记录回滚
 */
export function logRollback(
  projectRoot: string,
  proposalId: string,
  reason: string,
  success: boolean
): void {
  appendStructuredLog(projectRoot, {
    type: 'rollback',
    timestamp: new Date().toISOString(),
    proposalId,
    payload: { reason, success },
  });
}

/**
 * 记录运行时错误
 */
export function logError(
  projectRoot: string,
  proposalId: string | undefined,
  error: string,
  context?: Record<string, unknown>
): void {
  appendStructuredLog(projectRoot, {
    type: 'error',
    timestamp: new Date().toISOString(),
    proposalId,
    payload: { error, context: context || {} },
  });
}

// ============================================================================
// 读取操作
// ============================================================================

/**
 * 读取所有结构化日志，转换为 OptimizationLogEntry[]
 *
 * 只转换 `proposal_executed` 事件（与旧格式兼容），
 * 其他事件类型（optimize_start、test_run 等）会被跳过。
 *
 * 如需读取所有事件类型，使用 `readRawStructuredLog()`。
 *
 * 空文件处理：
 * - 文件不存在 → 返回空数组
 * - 文件为空 → 返回空数组
 * - 解析失败行 → 静默跳过
 *
 * @param projectRoot 项目根目录
 * @param config 日志配置（可选）
 * @returns OptimizationLogEntry 列表（仅 proposal_executed 事件）
 */
export function readStructuredLog(
  projectRoot: string,
  config?: Partial<StructuredLoggerConfig>
): OptimizationLogEntry[] {
  const cfg: StructuredLoggerConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const logPath = getLogPath(projectRoot, cfg);

  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries: OptimizationLogEntry[] = [];

    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const structured = JSON.parse(line) as StructuredLogEntry;

        // 只转换 proposal_executed 事件为 OptimizationLogEntry
        if (structured.type === 'proposal_executed' && structured.proposalId) {
          entries.push({
            proposal: {
              id: structured.proposalId,
              type: (structured.payload.target ? 'modify' : 'add') as OptimizationType,
              target: (structured.payload.target as string) || structured.proposalId,
              description: (structured.payload.lesson as string) || '',
              riskLevel: (structured.payload.riskLevel as RiskLevel) || 'low',
            },
            result: {
              proposalId: structured.proposalId,
              status: (structured.payload.status as any) || 'success',
              testResults: [],
              testSummary: (structured.payload.testSummary as any) || { total: 0, passed: 0, failed: 0 },
              fixAttempts: (structured.payload.fixAttempts as number) || 0,
              reverted: (structured.payload.reverted as boolean) || false,
              lesson: (structured.payload.lesson as string) || '',
              timestamp: structured.timestamp,
              totalDurationSeconds: (structured.payload.totalDurationSeconds as number) || 0,
            },
          });
        }
      } catch {
        // 跳过解析失败的行
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * 读取原始结构化日志条目（保留所有事件类型）
 *
 * 返回完整的 StructuredLogEntry[]，不转换、不过滤。
 * 适用于需要分析所有事件类型的场景（如趋势分析、错误追踪）。
 *
 * @param projectRoot 项目根目录
 * @param config 日志配置（可选）
 * @returns 原始结构化日志条目列表
 */
export function readRawStructuredLog(
  projectRoot: string,
  config?: Partial<StructuredLoggerConfig>
): StructuredLogEntry[] {
  const cfg: StructuredLoggerConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const logPath = getLogPath(projectRoot, cfg);

  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries: StructuredLogEntry[] = [];

    for (const line of content.split('\n').filter(Boolean)) {
      try {
        entries.push(JSON.parse(line) as StructuredLogEntry);
      } catch {
        // 跳过解析失败的行
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * 按事件类型过滤日志
 *
 * @param projectRoot 项目根目录
 * @param eventType 事件类型（如 'test_run'、'error'）
 * @param config 日志配置（可选）
 * @returns 匹配该事件类型的所有条目
 *
 * @example
 * ```ts
 * const errors = filterStructuredLog(projectRoot, 'error');
 * console.log(`共 ${errors.length} 条错误记录`);
 * ```
 */
export function filterStructuredLog(
  projectRoot: string,
  eventType: StructuredLogEventType,
  config?: Partial<StructuredLoggerConfig>
): StructuredLogEntry[] {
  const all = readRawStructuredLog(projectRoot, config);
  return all.filter(e => e.type === eventType);
}

/**
 * 按提案 ID 查询日志
 *
 * 查询特定提案的完整事件链（开始→执行→测试→修复→完成）。
 *
 * @param projectRoot 项目根目录
 * @param proposalId 提案 ID
 * @param config 日志配置（可选）
 * @returns 与该提案相关的所有事件条目
 *
 * @example
 * ```ts
 * const events = queryLogByProposalId(projectRoot, 'prop-123');
 * for (const e of events) {
 *   console.log(`[${e.type}] ${e.timestamp}: ${JSON.stringify(e.payload)}`);
 * }
 * ```
 */
export function queryLogByProposalId(
  projectRoot: string,
  proposalId: string,
  config?: Partial<StructuredLoggerConfig>
): StructuredLogEntry[] {
  const all = readRawStructuredLog(projectRoot, config);
  return all.filter(e => e.proposalId === proposalId);
}

/**
 * 导出日志为 JSON 数组（用于可视化/分析）
 *
 * 将 JSONL 格式转换为标准 JSON 数组，便于导入数据分析工具
 *（如 Excel、Tableau、Grafana）。
 *
 * 注意：大日志文件（>50MB）导出时可能占用较多内存。
 *
 * @param projectRoot 项目根目录
 * @param outputPath 输出文件的完整路径
 * @param config 日志配置（可选）
 */
export function exportStructuredLog(
  projectRoot: string,
  outputPath: string,
  config?: Partial<StructuredLoggerConfig>
): void {
  const entries = readRawStructuredLog(projectRoot, config);
  const output = JSON.stringify(entries, null, 2);
  fs.writeFileSync(outputPath, output, 'utf-8');
}

/**
 * 日志统计摘要
 *
 * 快速查看日志文件的整体情况，包括：
 * - 总条目数
 * - 各事件类型的数量分布
 * - 最早/最晚时间戳
 *
 * 用途：
 * - 健康检查：确认日志系统正常工作
 * - 调试：快速了解日志规模
 * - 运维：决定是否需要轮转或清理
 *
 * @param projectRoot 项目根目录
 * @param config 日志配置（可选）
 * @returns 统计摘要对象
 *
 * @example
 * ```ts
 * const stats = getLogStats(projectRoot);
 * console.log(`共 ${stats.totalEntries} 条记录`);
 * console.log('事件分布:', stats.byType);
 * ```
 */
export function getLogStats(
  projectRoot: string,
  config?: Partial<StructuredLoggerConfig>
): {
  totalEntries: number;
  byType: Record<string, number>;
  firstTimestamp?: string;
  lastTimestamp?: string;
} {
  const entries = readRawStructuredLog(projectRoot, config);

  const byType: Record<string, number> = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const timestamps = entries
    .map(e => e.timestamp)
    .filter(Boolean)
    .sort();

  return {
    totalEntries: entries.length,
    byType,
    firstTimestamp: timestamps.length > 0 ? timestamps[0] : undefined,
    lastTimestamp: timestamps.length > 0 ? timestamps[timestamps.length - 1] : undefined,
  };
}
