/**
 * @file runtime-error-collector.ts - 运行时错误收集器 (Phase 5.2 新增)
 * @description
 *   Self-Optimization 子系统的核心组件之一。收集运行时错误并持久化到日志文件，
 *   为错误分析引擎（error-analyzer.ts）提供数据源。
 *
 *   工作流程：
 *   1. Agent/Tool 执行时捕获到错误，调用 collectError()
 *   2. 错误被序列化为 JSON Line，追加写入 errors/error-log.jsonl
 *   3. error-analyzer.ts 定期读取日志，聚类分析，生成修复方案
 *
 *   设计原则
 *   - 异步写入，不阻塞主流程
 *   - JSON Lines 格式，每行一个独立错误记录
 *   - 自动去重计数（相同错误类型+堆栈 hash）
 *   - 与 loop-detector.ts 集成：高频错误触发自动修复
 *
 * @module core/self-opt/runtime-error-collector
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ensureDir } from '../../utils/fs.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 运行时错误记录
 */
export interface RuntimeErrorRecord {
  /** 唯一 ID */
  id: string;
  /** 时间戳 ISO */
  timestamp: string;
  /** 错误类型（Error/TypeError/RangeError 等） */
  errorType: string;
  /** 错误消息 */
  message: string;
  /** 堆栈追踪（截断到前 10 行） */
  stack: string;
  /** 堆栈哈希（用于去重） */
  stackHash: string;
  /** 错误发生的上下文 */
  context: ErrorContext;
  /** 该错误的累计出现次数（本次收集时更新） */
  occurrenceCount: number;
}

/**
 * 错误上下文
 */
export interface ErrorContext {
  /** 触发错误的工具/模块名 */
  tool?: string;
  /** 输入参数（截断到 500 字符） */
  input?: string;
  /** 当前执行的提案 ID（如果有） */
  proposalId?: string;
  /** 额外元数据 */
  meta?: Record<string, unknown>;
}

/**
 * 错误日志文件路径配置
 */
export interface ErrorLogConfig {
  /** 错误日志目录（默认：项目根目录/errors） */
  logDir: string;
  /** 最大单文件大小（字节，默认 10MB） */
  maxFileSize: number;
  /** 日志轮转后缀（默认：时间戳） */
  rotationSuffix?: string;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: ErrorLogConfig = {
  logDir: path.resolve(process.cwd(), 'errors'),
  maxFileSize: 10 * 1024 * 1024, // 10MB
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算堆栈哈希（用于去重）
 */
function computeStackHash(stack: string): string {
  // 只取前 5 行作为 hash 输入，忽略行号差异
  const normalized = stack
    .split('\n')
    .slice(0, 5)
    .map((line) => line.replace(/:\d+:\d+/g, ':0:0')) // 抹去行号
    .join('\n');
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 8);
}

/**
 * 截断字符串到指定长度
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...（truncated）';
}

/**
 * 获取错误日志文件路径
 */
function getLogFilePath(config: ErrorLogConfig): string {
  const suffix = config.rotationSuffix || new Date().toISOString().slice(0, 10);
  return path.join(config.logDir, `error-log-${suffix}.jsonl`);
}

/**
 * 读取现有的错误日志，统计每个 stackHash 的出现次数
 */
function countOccurrences(
  logPath: string,
  stackHash: string
): number {
  if (!fs.existsSync(logPath)) return 0;
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as RuntimeErrorRecord;
        if (record.stackHash === stackHash) count++;
      } catch {
        // 跳过解析失败的行
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 收集运行时错误
 *
 * 将错误信息序列化并追加到错误日志文件。
 * 同时返回完整记录，供调用方检查。
 *
 * @param error 捕获到的 Error 对象
 * @param context 错误发生的上下文（工具名、输入等）
 * @param config 日志配置（可选，使用默认值）
 * @returns 错误记录
 *
 * @example
 * ```ts
 * try {
 *   await tool.execute(input);
 * } catch (err) {
 *   const record = collectError(err as Error, {
 *     tool: 'filesystem',
 *     input: JSON.stringify(input).slice(0, 500),
 *   });
 *   console.log(`错误已记录，累计发生 ${record.occurrenceCount} 次`);
 * }
 * ```
 */
export function collectError(
  error: Error,
  context: ErrorContext = {},
  config: Partial<ErrorLogConfig> = {}
): RuntimeErrorRecord {
  const cfg: ErrorLogConfig = { ...DEFAULT_CONFIG, ...config };

  // 确保日志目录存在
  ensureDir(cfg.logDir);

  const stack = error.stack || '';
  const stackHash = computeStackHash(stack);
  const logPath = getLogFilePath(cfg);

  // 统计已有出现次数
  const occurrenceCount = countOccurrences(logPath, stackHash) + 1;

  // 构建记录
  const record: RuntimeErrorRecord = {
    id: 'err-' + Date.now() + '-' + stackHash.slice(0, 4),
    timestamp: new Date().toISOString(),
    errorType: error.name || 'Error',
    message: truncate(error.message, 1000),
    stack: truncate(stack.split('\n').slice(0, 10).join('\n'), 2000),
    stackHash,
    context: {
      tool: context.tool,
      input: context.input ? truncate(context.input, 500) : undefined,
      proposalId: context.proposalId,
      meta: context.meta,
    },
    occurrenceCount,
  };

  // 追加写入 JSONL
  const line = JSON.stringify(record) + '\n';
  try {
    // 检查文件大小，超过阈值则轮转
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > cfg.maxFileSize) {
        // 轮转：重命名旧文件
        const rotatedPath = logPath + '.bak';
        fs.renameSync(logPath, rotatedPath);
      }
    }
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (writeErr) {
    // 写入失败不影响主流程
    console.error('[runtime-error-collector] 写入错误日志失败:', writeErr);
  }

  return record;
}

/**
 * 批量收集错误（用于一次性导入历史错误）
 */
export function collectErrors(
  errors: Array<{ error: Error; context?: ErrorContext }>,
  config?: Partial<ErrorLogConfig>
): RuntimeErrorRecord[] {
  return errors.map((e) => collectError(e.error, e.context || {}, config));
}

/**
 * 读取最近的错误记录
 * @param limit 最大返回条数
 * @param config 日志配置
 */
export function getRecentErrors(
  limit: number = 50,
  config?: Partial<ErrorLogConfig>
): RuntimeErrorRecord[] {
  const cfg: ErrorLogConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const logPath = getLogFilePath(cfg);
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const records: RuntimeErrorRecord[] = [];
    for (const line of content.split('\n').reverse()) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
        if (records.length >= limit) break;
      } catch { /* skip */ }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * 检查是否存在高频错误（出现次数超过阈值）
 * @param threshold 触发阈值
 * @returns 高频错误的 stackHash 列表
 */
export function detectFrequentErrors(
  threshold: number = 5,
  config?: Partial<ErrorLogConfig>
): string[] {
  const cfg: ErrorLogConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  const logPath = getLogFilePath(cfg);
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    const counts = new Map<string, number>();
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as RuntimeErrorRecord;
        counts.set(r.stackHash, (counts.get(r.stackHash) || 0) + 1);
      } catch { /* skip */ }
    }

    const frequent: string[] = [];
    for (const [hash, count] of counts) {
      if (count >= threshold) frequent.push(hash);
    }
    return frequent;
  } catch {
    return [];
  }
}
