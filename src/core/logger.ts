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

/** 追加一条日志到文件 */
export function appendLog(logFile: string, entry: Record<string, unknown>): void {
  // 确保父目录存在
  const dir = path.dirname(logFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(logFile, line, "utf8");
}

/** 安全截取大对象，避免日志文件膨胀 */
export function truncate(obj: unknown, maxLen = 2000): string {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + `\n... [truncated, total ${s.length} chars]` : s;
}
