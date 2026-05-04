/**
 * @file logger.ts — 增量日志写入器
 * @description
 *   将 LLM 的输入/输出增量追加到指定文件。
 *   每行一个 JSON 对象，方便后续解析或 tail -f 实时观察。
 *
 * 日志格式（每行 JSON）：
 * {
 *   "ts": "2026-05-01T08:00:00.000Z",
 *   "phase": "plan" | "exec",
 *   "turn": 1,           // 轮次，从 1 开始
 *   "req": {             // 发给 LLM 的消息
 *     "messages": [...],
 *     "model": "qwen3.6-plus",
 *     "temperature": 0.3
 *   },
 *   "res": {             // LLM 返回
 *     "content": "...",
 *     "tool_calls": [...],
 *     "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
 *   },
 *   "err": "..."         // 异常时才有
 * }
 *
 * @module core/logger
 */

import * as fs from "fs";
import * as path from "path";
import { ensureDir } from "../utils/fs.js";

/**
 * 追加一条日志到文件
 *
 * 每行追加一个 JSON 对象，包含时间戳。如果父目录不存在则自动创建。
 *
 * @param logFile - 日志文件的完整路径
 * @param entry - 要写入的日志条目（自动附加 ts 时间戳）
 *
 * @example
 *   appendLog('./logs/agent.jsonl', {
 *     phase: 'exec',
 *     turn: 1,
 *     res: { content: 'Hello!' }
 *   });
 */
export function appendLog(logFile: string, entry: Record<string, unknown>): void {
  // 确保父目录存在
  const dir = path.dirname(logFile);
  ensureDir(dir);

  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(logFile, line, "utf8");
}

/**
 * 安全截取大对象，避免日志文件膨胀
 *
 * 将任意对象转为字符串，超过 maxLen 时截断并附加提示。
 *
 * @param obj - 要格式化的对象
 * @param maxLen - 最大字符数（默认 2000）
 * @returns 格式化后的字符串（可能被截断）
 *
 * @example
 *   truncate({ large: 'data'.repeat(1000) }, 50);
 *   // → "{\n  \"large\": \"datadatadat...\n... [truncated, total N chars]"
 */
export function truncate(obj: unknown, maxLen = 2000): string {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + `\n... [truncated, total ${s.length} chars]` : s;
}
