/**
 * @file instance-manager.ts — 单实例管理
 * @description
 *   确保 mini-agent 同一时间只有一个运行实例。
 *   类似 OpenClaw 的 instance guard 机制。
 *
 *   工作原理：
 *   1. 启动时创建 PID 文件：`.mini-agent-state/instance.pid`
 *   2. 如果 PID 文件已存在，检查对应进程是否存活
 *   3. 进程存活 → 拒绝启动（另一实例正在运行）
 *   4. 进程死亡 → 清理过期 PID 文件，允许启动
 *   5. 退出时自动删除 PID 文件
 *
 *   适用于 Windows / macOS / Linux。
 *
 * @module core/instance-manager
 */

import * as fs from "node:fs";
import * as path from "node:path";

const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  ".mini-agent-state",
);
const PID_FILE = path.join(STATE_DIR, "instance.pid");

// ============================================================================
// 进程检测
// ============================================================================

/**
 * 检测 PID 对应的进程是否仍在运行
 *
 * Windows: 使用 tasklist
 * Unix: 使用 kill -0
 */
function isProcessRunning(pid: number): boolean {
  try {
    if (process.platform === "win32") {
      // Windows: 用 tasklist 检查进程
      const { execSync } = require("child_process");
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, {
        encoding: "utf-8",
        timeout: 5000,
      });
      // 如果输出包含 PID，说明进程还在
      return output.includes(`"${pid}"`);
    } else {
      // Unix: kill -0 不发送信号，只检查进程是否存在
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 尝试获取单实例锁
 * @returns true = 获取成功，可以启动；false = 已有实例在运行
 */
export function tryAcquireInstance(): { success: true } | { success: false; existingPid: number } {
  ensureStateDir();

  // 读取现有 PID 文件
  if (fs.existsSync(PID_FILE)) {
    try {
      const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
      const existingPid = parseInt(raw, 10);

      if (!isNaN(existingPid) && isProcessRunning(existingPid)) {
        // 另一个实例正在运行
        return { success: false, existingPid };
      }

      // PID 文件存在但进程已死（崩溃/强制关闭残留）
      console.log(`⚠️ 检测到过期 PID 文件 (PID=${existingPid})，进程已不存在，清理中...`);
      fs.unlinkSync(PID_FILE);
    } catch (err) {
      // PID 文件损坏，删除重建
      console.warn("⚠️ PID 文件读取失败，清理中...");
      try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    }
  }

  // 写入当前 PID
  fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
  return { success: true };
}

/**
 * 强制获取单实例锁（杀死已有进程）
 * @returns true = 成功；false = 无法终止
 */
export function forceAcquireInstance(): { success: true } | { success: false; reason: string } {
  ensureStateDir();

  if (!fs.existsSync(PID_FILE)) {
    fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
    return { success: true };
  }

  try {
    const raw = fs.readFileSync(PID_FILE, "utf-8").trim();
    const existingPid = parseInt(raw, 10);

    if (isNaN(existingPid) || !isProcessRunning(existingPid)) {
      fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
      return { success: true };
    }

    // 尝试终止已有进程
    console.log(`⚠️ 正在终止旧实例 (PID=${existingPid})...`);
    try {
      if (process.platform === "win32") {
        const { execSync } = require("child_process");
        execSync(`taskkill /PID ${existingPid} /F`, {
          encoding: "utf-8",
          timeout: 10000,
        });
      } else {
        process.kill(existingPid, "SIGTERM");
        // 等待进程退出
        for (let i = 0; i < 50; i++) {
          if (!isProcessRunning(existingPid)) break;
          require("child_process").execSync("sleep 0.1", { timeout: 1000 });
        }
      }
    } catch (killErr) {
      return { success: false, reason: `无法终止 PID=${existingPid} 的进程` };
    }

    // 清理并写入新 PID
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    fs.writeFileSync(PID_FILE, String(process.pid), "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, reason: String(err) };
  }
}

/**
 * 释放单实例锁（退出时调用）
 */
export function releaseInstance(): void {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // 忽略清理失败
  }
}

/**
 * 确保状态目录存在
 */
function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}
