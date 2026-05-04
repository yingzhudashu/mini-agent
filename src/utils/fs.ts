/**
 * @file fs.ts — 公共文件系统工具
 * @description
 *   提供文件系统操作的公共工具函数：
 *   - ensureDir: 递归创建目录
 *   - getDefaultWorkspace: 获取默认工作空间路径
 *   - 状态目录路径常量（STATE_DIR、MEMORY_DIR、FEISHU_STATE_DIR）
 *
 *   所有路径相关模块共享这些工具，避免重复定义。
 *
 * @module utils/fs
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================================
// 通用
// ============================================================================

/**
 * 确保目录存在（不存在则递归创建）
 *
 * @param dirPath - 目标目录的绝对路径或相对路径
 * @returns 无返回值
 *
 * @example
 *   ensureDir('/path/to/nested/dir');
 *   // 如果 /path/to/nested/dir 不存在，则递归创建所有父目录
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 获取默认工作空间根目录
 *
 * 优先级：
 * 1. 环境变量 MINI_AGENT_WORKSPACE（用户显式指定）
 * 2. 当前工作目录 process.cwd()（默认行为）
 *
 * @returns 工作空间根目录路径
 *
 * @example
 *   // 使用默认工作目录
 *   const ws = getDefaultWorkspace();
 *
 *   // 使用自定义工作空间
 *   // 在 .env 中设置: MINI_AGENT_WORKSPACE=/custom/path
 */
export function getDefaultWorkspace(): string {
  return process.env.MINI_AGENT_WORKSPACE ?? process.cwd();
}

// ============================================================================
// 状态目录路径（集中管理）
// ============================================================================

/** 状态目录：.mini-agent-state/ */
export const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || getDefaultWorkspace(),
  ".mini-agent-state",
);

/** 记忆子目录：.mini-agent-state/memory/ */
export const MEMORY_DIR = path.join(STATE_DIR, "memory");

/** Feishu 状态子目录：.mini-agent-state/feishu/ */
export const FEISHU_STATE_DIR = path.join(STATE_DIR, "feishu");

/**
 * 确保 .mini-agent-state 目录存在
 *
 * @returns 无返回值
 *
 * @example
 *   ensureStateDir(); // 确保状态目录已创建
 */
export function ensureStateDir(): void {
  ensureDir(STATE_DIR);
}

/**
 * 确保记忆存储目录 .mini-agent-state/memory/ 存在
 *
 * @returns 无返回值
 *
 * @example
 *   ensureMemoryDir(); // 确保记忆目录已创建
 */
export function ensureMemoryDir(): void {
  ensureDir(MEMORY_DIR);
}
