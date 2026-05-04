/**
 * @file workspace-manager.ts — 会话工作空间管理
 * @description
 *   每个会话的工作空间文件系统管理。
 *   会话只能访问自己的 files/ 目录，除非显式访问主空间共享文件。
 *
 *   职责：
 *   1. 创建/删除/列出会话工作空间
 *   2. 文件操作（读/写/复制/删除），自动限制在会话目录内
 *   3. 主空间共享文件访问
 *
 * @module session/workspace
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "../utils/fs.js";

// ============================================================================
// 路径
// ============================================================================

const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  ".mini-agent-state",
);
const WORKSPACES_DIR = path.join(STATE_DIR, "workspaces");
const MAIN_DIR = path.join(STATE_DIR, "main");
const MAIN_SHARED_DIR = path.join(MAIN_DIR, "shared-files");

// ============================================================================
// WorkspaceManager
// ============================================================================

export class WorkspaceManager {
  /**
   * 确保主空间目录存在
   * @description 创建 .mini-agent-state/main/ 和 shared-files/ 目录。
   * @returns 无返回值
   */
  ensureMainSpace(): void {
    ensureDir(MAIN_DIR);
    ensureDir(MAIN_SHARED_DIR);
  }

  /**
   * 获取主空间共享目录路径
   * @returns 主空间共享目录的绝对路径
   */
  getMainSharedPath(): string {
    this.ensureMainSpace();
    return MAIN_SHARED_DIR;
  }

  /**
   * 复制文件到主空间共享目录（升维操作）
   *
   * @param sourcePath - 源文件的绝对路径
   * @param filename - 目标文件名
   * @returns { success: boolean, message: string } 操作结果
   *
   * @example
   *   const result = wm.promoteFile('/path/to/file.txt', 'file.txt');
   *   if (result.success) console.log('文件已复制到主空间');
   */
  promoteFile(sourcePath: string, filename: string): { success: boolean; message: string } {
    this.ensureMainSpace();
    try {
      const destPath = path.join(MAIN_SHARED_DIR, filename);
      fs.copyFileSync(sourcePath, destPath);
      return { success: true, message: `✅ "${filename}" 已复制到主空间` };
    } catch (err) {
      return { success: false, message: `❌ 复制失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 列出工作空间文件
   *
   * @param filesPath - 会话文件目录的绝对路径
   * @param subPath - 可选子路径（相对于 filesPath）
   * @returns 文件/目录信息数组，按类型排序（目录在前，按名称字母排序）
   *
   * @example
   *   const files = wm.listFiles('/workspace/files', 'src');
   *   // => [{ name: 'index.ts', path: 'src/index.ts', size: 1024, ... }]
   */
  listFiles(filesPath: string, subPath: string = ""): Array<{
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
    modifiedAt: string;
  }> {
    const targetPath = subPath ? path.join(filesPath, subPath) : filesPath;

    if (!fs.existsSync(targetPath)) return [];

    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    return entries
      .map((entry) => {
        const fullPath = path.join(targetPath, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          path: path.relative(filesPath, fullPath),
          size: stat.size,
          isDirectory: entry.isDirectory(),
          modifiedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * 读取文件内容（带安全检查）
   *
   * @param filesPath - 会话文件目录的绝对路径
   * @param filePath - 文件相对于 filesPath 的相对路径
   * @returns { success, content?, message? } 操作结果
   *
   * @example
   *   const result = wm.readFile('/workspace/files', 'notes.txt');
   *   if (result.success) console.log(result.content);
   */
  readFile(filesPath: string, filePath: string): { success: boolean; content?: string; message?: string } {
    const targetPath = path.join(filesPath, filePath);

    // 安全检查：确保路径在会话目录内
    if (!targetPath.startsWith(filesPath)) {
      return { success: false, message: "⚠️ 路径越界，无法访问" };
    }

    if (!fs.existsSync(targetPath)) {
      return { success: false, message: `⚠️ 文件不存在: ${filePath}` };
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return { success: false, message: `⚠️ 这是一个目录: ${filePath}` };
    }

    if (stat.size > 10 * 1024 * 1024) {
      return { success: false, message: `⚠️ 文件过大（>${10}MB），无法读取` };
    }

    try {
      const content = fs.readFileSync(targetPath, "utf-8");
      return { success: true, content };
    } catch (err) {
      return { success: false, message: `❌ 读取失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 写入文件内容（带安全检查）
   *
   * @param filesPath - 会话文件目录的绝对路径
   * @param filePath - 文件相对于 filesPath 的相对路径
   * @param content - 要写入的文本内容
   * @returns { success, message } 操作结果
   *
   * @example
   *   wm.writeFile('/workspace/files', 'hello.txt', 'Hello World');
   */
  writeFile(filesPath: string, filePath: string, content: string): { success: boolean; message: string } {
    const targetPath = path.join(filesPath, filePath);

    // 安全检查
    if (!targetPath.startsWith(filesPath)) {
      return { success: false, message: "⚠️ 路径越界，无法写入" };
    }

    try {
      ensureDir(path.dirname(targetPath));
      fs.writeFileSync(targetPath, content, "utf-8");
      return { success: true, message: `✅ 已写入: ${filePath}` };
    } catch (err) {
      return { success: false, message: `❌ 写入失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 删除文件或目录（带安全检查）
   *
   * @param filesPath - 会话文件目录的绝对路径
   * @param filePath - 文件相对于 filesPath 的相对路径
   * @returns { success, message } 操作结果
   *
   * @example
   *   wm.deleteFile('/workspace/files', 'old.txt');
   */
  deleteFile(filesPath: string, filePath: string): { success: boolean; message: string } {
    const targetPath = path.join(filesPath, filePath);

    if (!targetPath.startsWith(filesPath)) {
      return { success: false, message: "⚠️ 路径越界，无法删除" };
    }

    if (!fs.existsSync(targetPath)) {
      return { success: false, message: `⚠️ 文件不存在: ${filePath}` };
    }

    try {
      fs.rmSync(targetPath, { recursive: true });
      return { success: true, message: `✅ 已删除: ${filePath}` };
    } catch (err) {
      return { success: false, message: `❌ 删除失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 获取工作空间统计信息
   *
   * @param filesPath - 会话文件目录的绝对路径
   * @returns { fileCount, directoryCount, totalSize, lastModified } 统计结果
   *
   * @example
   *   const stats = wm.getStats('/workspace/files');
   *   console.log(`共 ${stats.fileCount} 个文件，总大小 ${stats.totalSize} 字节`);
   */
  getStats(filesPath: string): {
    fileCount: number;
    directoryCount: number;
    totalSize: number;
    lastModified: string;
  } {
    if (!fs.existsSync(filesPath)) {
      return { fileCount: 0, directoryCount: 0, totalSize: 0, lastModified: "" };
    }

    let fileCount = 0;
    let directoryCount = 0;
    let totalSize = 0;
    let lastModified = "";

    function scanDir(dirPath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          directoryCount++;
          scanDir(fullPath);
        } else {
          fileCount++;
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
          if (stat.mtime.toISOString() > lastModified) {
            lastModified = stat.mtime.toISOString();
          }
        }
      }
    }

    scanDir(filesPath);
    return { fileCount, directoryCount, totalSize, lastModified };
  }
}

// ============================================================================
// 单例
// ============================================================================

let singletonWorkspace: WorkspaceManager | null = null;

export function getWorkspaceManager(): WorkspaceManager {
  if (!singletonWorkspace) {
    singletonWorkspace = new WorkspaceManager();
  }
  return singletonWorkspace;
}
