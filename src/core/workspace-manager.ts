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
 * @module core/workspace-manager
 */

import * as fs from "node:fs";
import * as path from "node:path";

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
  /** 确保主空间目录存在 */
  ensureMainSpace(): void {
    if (!fs.existsSync(MAIN_DIR)) {
      fs.mkdirSync(MAIN_DIR, { recursive: true });
    }
    if (!fs.existsSync(MAIN_SHARED_DIR)) {
      fs.mkdirSync(MAIN_SHARED_DIR, { recursive: true });
    }
  }

  /** 获取主空间共享目录路径 */
  getMainSharedPath(): string {
    this.ensureMainSpace();
    return MAIN_SHARED_DIR;
  }

  /**
   * 复制文件到主空间共享目录
   * @param sourcePath 源文件路径
   * @param filename 目标文件名
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
   * @param filesPath 会话文件目录
   * @param subPath 可选子路径
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
   * 读取文件内容
   * @param filesPath 会话文件目录
   * @param filePath 文件相对路径
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
   * 写入文件内容
   * @param filesPath 会话文件目录
   * @param filePath 文件相对路径
   * @param content 文件内容
   */
  writeFile(filesPath: string, filePath: string, content: string): { success: boolean; message: string } {
    const targetPath = path.join(filesPath, filePath);

    // 安全检查
    if (!targetPath.startsWith(filesPath)) {
      return { success: false, message: "⚠️ 路径越界，无法写入" };
    }

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf-8");
      return { success: true, message: `✅ 已写入: ${filePath}` };
    } catch (err) {
      return { success: false, message: `❌ 写入失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * 删除文件
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
   * 获取工作空间统计
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
