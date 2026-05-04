/**
 * @file session-manager.ts — 多会话管理器
 * @description
 *   每个会话拥有独立的工作空间、工具注册表、技能、记忆。
 *   会话间默认完全隔离，除非显式"升维"才共享到主空间。
 *
 *   工作空间结构：
 *   .mini-agent-state/
 *   ├── workspaces/
 *   │   └── <sessionId>/
 *   │       ├── files/        — 会话文件（工具操作默认目录）
 *   │       ├── skills/       — 会话级技能
 *   │       └── config.json   — 会话配置
 *   ├── memory/
 *   │   ├── <sessionId>.json
 *   │   └── keyword-index.json
 *   └── instance.pid
 *
 * @module session/manager
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "../utils/fs.js";
import type {
  ToolDefinition,
  ToolRegistry,
  ToolContext,
  Toolbox,
  Skill,
  RegisteredTool,
} from "../types/index.js";
import { DefaultToolRegistry } from "../core/registry.js";

// ============================================================================
// 路径
// ============================================================================

const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  ".mini-agent-state",
);
const WORKSPACES_DIR = path.join(STATE_DIR, "workspaces");

// ============================================================================
// 会话上下文
// ============================================================================

/**
 * 会话配置
 */
export interface SessionConfig {
  /** 会话 ID */
  sessionId: string;
  /** 工作空间路径 */
  workspacePath: string;
  /** 文件目录（工具操作默认位置） */
  filesPath: string;
  /** 技能目录 */
  skillsPath: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActive: string;
  /** 描述 */
  description: string;
  /** 关联的 chatId */
  chatId?: string;
  /** 关联的 senderId */
  senderId?: string;
}

/**
 * 会话上下文：一个会话的完整运行环境
 */
export interface SessionContext {
  /** 会话 ID */
  sessionId: string;
  /** 会话配置 */
  config: SessionConfig;
  /** 会话级工具注册表（独立） */
  registry: ToolRegistry;
  /** 会话级工具箱列表 */
  toolboxes: Toolbox[];
  /** 会话级技能 */
  skills: Skill[];
  /** 对话历史（跨轮次保留，v4.9.3 新增） */
  conversationHistory: Array<{ role: string; content: string }>;
}

// ============================================================================
// SessionManager
// ============================================================================

/**
 * 多会话管理器
 *
 * 职责：
 * 1. 每个会话独立的工作空间、工具注册表、技能
 * 2. 会话隔离，默认不共享
 * 3. "升维"机制：将工具/技能提升到主空间（所有会话可见）
 * 4. 核心工具自动克隆到新会话
 */
export class SessionManager {
  /** 活跃会话 */
  private sessions = new Map<string, SessionContext>();

  /** 主空间：共享注册表 */
  private mainRegistry: ToolRegistry;
  /** 主空间：共享工具箱 */
  private mainToolboxes: Toolbox[];
  /** 主空间：共享技能 */
  private mainSkills: Skill[];

  constructor(
    mainRegistry: ToolRegistry,
    mainToolboxes: Toolbox[] = [],
    mainSkills: Skill[] = [],
  ) {
    this.mainRegistry = mainRegistry;
    this.mainToolboxes = mainToolboxes;
    this.mainSkills = mainSkills;
    this.ensureWorkspacesDir();
  }

  // -----------------------------------------------------------------------
  // 会话生命周期
  // -----------------------------------------------------------------------

  /**
   * 获取或创建会话
   *
   * - 已存在 → 返回现有上下文
   * - 不存在 → 创建工作空间 + 注册表 + 克隆核心工具
   */
  getOrCreate(
    sessionId: string,
    options: {
      chatId?: string;
      senderId?: string;
      description?: string;
    } = {},
  ): SessionContext {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.config.lastActive = new Date().toISOString();
      return existing;
    }
    return this.create(sessionId, options);
  }

  /**
   * 创建新会话
   *
   * - 清理 sessionId 中的非法字符（Windows 不允许 : * ? " < > |）
   * - 创建独立的工作空间（files/ + skills/）
   * - 克隆主空间的核心工具（无 toolbox 的工具）
   *
   * @param sessionId - 会话唯一标识
   * @param options - 可选参数（chatId、senderId、description）
   * @returns 新创建的会话上下文
   */
  private create(
    sessionId: string,
    options: { chatId?: string; senderId?: string; description?: string },
  ): SessionContext {
    // v4.9.3: 将非法路径字符替换为安全字符（Windows 不允许 : * ? " < > |）
    const safeId = sessionId.replace(/[<>:"/\\|?*]/g, "_");
    const workspacePath = path.join(WORKSPACES_DIR, safeId);
    const filesPath = path.join(workspacePath, "files");
    const skillsPath = path.join(workspacePath, "skills");

    ensureDir(filesPath);
    ensureDir(skillsPath);

    const config: SessionConfig = {
      sessionId,
      workspacePath,
      filesPath,
      skillsPath,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      description: options.description || "",
      chatId: options.chatId,
      senderId: options.senderId,
    };

    this.saveConfig(config);

    // 会话级注册表
    const registry = new DefaultToolRegistry();

    // 克隆主空间的核心工具（无 toolbox 的 = 核心能力）
    let coreCount = 0;
    for (const [name, tool] of this.mainRegistry.getAll()) {
      if (!tool.toolbox) {
        try {
          registry.register(name, { ...tool });
          coreCount++;
        } catch {
          // 已存在，跳过
        }
      }
    }

    const ctx: SessionContext = {
      sessionId,
      config,
      registry,
      toolboxes: [],
      skills: [],
      conversationHistory: [],
    };

    this.sessions.set(sessionId, ctx);
    console.log(`🆕 会话已创建: ${sessionId} (${coreCount} 个核心工具) [${filesPath}]`);
    return ctx;
  }

  /**
   * 销毁会话
   *
   * @param sessionId - 要销毁的会话 ID
   * @param keepFiles - 是否保留工作空间文件（默认 true）
   * @returns 成功返回 true，会话不存在返回 false
   */
  destroy(sessionId: string, keepFiles = true): boolean {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return false;

    ctx.config.lastActive = new Date().toISOString();
    this.saveConfig(ctx.config);
    this.sessions.delete(sessionId);

    if (!keepFiles) {
      try {
        fs.rmSync(ctx.config.workspacePath, { recursive: true, force: true });
      } catch {
        // 忽略
      }
    }

    console.log(`👋 会话已销毁: ${sessionId}`);
    return true;
  }

  /**
   * 列出所有活跃会话
   *
   * @returns 会话信息数组，包含 ID、描述、工具数等
   */
  list(): Array<{
    sessionId: string;
    description: string;
    createdAt: string;
    lastActive: string;
    toolCount: number;
    skillCount: number;
    filesPath: string;
  }> {
    const result: Array<{
      sessionId: string;
      description: string;
      createdAt: string;
      lastActive: string;
      toolCount: number;
      skillCount: number;
      filesPath: string;
    }> = [];

    for (const [, ctx] of this.sessions.entries()) {
      result.push({
        sessionId: ctx.sessionId,
        description: ctx.config.description,
        createdAt: ctx.config.createdAt,
        lastActive: ctx.config.lastActive,
        toolCount: ctx.registry.list().length,
        skillCount: ctx.skills.length,
        filesPath: ctx.config.filesPath,
      });
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // 工具执行上下文
  // -----------------------------------------------------------------------

  /**
   * 获取会话的工具执行上下文（cwd = 会话文件目录）
   *
   * @param sessionId - 会话 ID
   * @returns 工具执行上下文，包含 cwd、allowedPaths、permission
   */
  toolContext(sessionId: string): ToolContext {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) {
      return {
        cwd: process.env.MINI_AGENT_WORKSPACE || process.cwd(),
        allowedPaths: [process.env.MINI_AGENT_WORKSPACE || process.cwd()],
        permission: "allowlist",
      };
    }

    return {
      cwd: ctx.config.filesPath,
      allowedPaths: [ctx.config.filesPath],
      permission: "allowlist",
    };
  }

  // -----------------------------------------------------------------------
  // 会话级工具管理
  // -----------------------------------------------------------------------

  /**
   * 在会话中注册工具
   *
   * @param sessionId - 目标会话 ID
   * @param name - 工具名称
   * @param tool - 工具定义
   * @returns 成功返回 true，会话不存在返回 false
   */
  registerTool(sessionId: string, name: string, tool: ToolDefinition): boolean {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return false;
    try {
      ctx.registry.register(name, tool);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从会话注销工具
   *
   * @param sessionId - 目标会话 ID
   * @param name - 工具名称
   * @returns 成功返回 true，会话不存在或工具不存在返回 false
   */
  unregisterTool(sessionId: string, name: string): boolean {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return false;
    return ctx.registry.unregister(name);
  }

  // -----------------------------------------------------------------------
  // 升维：会话 → 主空间
  // -----------------------------------------------------------------------

  /**
   * 升维：将工具提升到主空间
   * 升维后，所有新会话都能获得该工具
   */
  promoteTool(
    sessionId: string,
    toolName: string,
  ): { success: boolean; message: string } {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return { success: false, message: `会话不存在: ${sessionId}` };

    const tool = ctx.registry.get(toolName);
    if (!tool) return { success: false, message: `工具不存在: ${toolName}` };

    try {
      this.mainRegistry.register(toolName, {
        schema: tool.schema,
        handler: tool.handler,
        permission: tool.permission,
        help: tool.help,
        toolbox: tool.toolbox,
      });
      return { success: true, message: `✅ "${toolName}" 已升维到主空间` };
    } catch {
      return { success: false, message: `⚠️ "${toolName}" 已在主空间存在` };
    }
  }

  /**
   * 批量升维：将当前会话的所有工具提升到主空间
   *
   * @param sessionId - 源会话 ID
   * @returns 每个工具的升维结果
   */
  promoteAllTools(sessionId: string): Array<{ name: string; success: boolean; message: string }> {
    const ctx = this.sessions.get(sessionId);
    if (!ctx) return [];

    return ctx.registry.list().map((name) => ({
      name,
      ...this.promoteTool(sessionId, name),
    }));
  }

  // -----------------------------------------------------------------------
  // 降维：主空间移除
  // -----------------------------------------------------------------------

  /**
   * 从主空间注销工具（所有会话不再看到）
   *
   * @param toolName - 要移除的工具名称
   * @returns 操作结果
   */
  demoteTool(toolName: string): { success: boolean; message: string } {
    try {
      this.mainRegistry.unregister(toolName);
      return { success: true, message: `✅ "${toolName}" 已从主空间移除` };
    } catch {
      return { success: false, message: `⚠️ "${toolName}" 不在主空间` };
    }
  }

  // -----------------------------------------------------------------------
  // 主空间查询
  // -----------------------------------------------------------------------

  /**
   * 获取主空间所有工具名称
   * @returns 工具名称数组
   */
  getMainTools(): string[] {
    return this.mainRegistry.list();
  }

  /**
   * 获取主空间所有技能
   * @returns 技能数组（副本）
   */
  getMainSkills(): Skill[] {
    return [...this.mainSkills];
  }

  /**
   * 获取主空间所有工具箱
   * @returns 工具箱数组（副本）
   */
  getMainToolboxes(): Toolbox[] {
    return [...this.mainToolboxes];
  }

  /**
   * 获取主空间工具注册表
   * @returns 主空间的 ToolRegistry 实例
   */
  getMainRegistry(): ToolRegistry {
    return this.mainRegistry;
  }

  // -----------------------------------------------------------------------
  // 内部
  // -----------------------------------------------------------------------

  private ensureWorkspacesDir(): void {
    ensureDir(WORKSPACES_DIR);
  }

  private saveConfig(config: SessionConfig): void {
    try {
      const configPath = path.join(config.workspacePath, "config.json");
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch {
      // 忽略
    }
  }
}

// ============================================================================
// 单例
// ============================================================================

let singleton: SessionManager | null = null;

export function getSessionManager(
  mainRegistry: ToolRegistry,
  mainToolboxes: Toolbox[] = [],
  mainSkills: Skill[] = [],
): SessionManager {
  if (!singleton) {
    singleton = new SessionManager(mainRegistry, mainToolboxes, mainSkills);
  }
  return singleton;
}
