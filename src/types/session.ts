/**
 * @file session.ts — 会话管理类型
 * @description
 *   v4.7 新增：多会话管理系统。
 *
 *   核心概念：
 *   - Session: 独立会话上下文（隔离的工具注册表、工作空间、配置）
 *   - SessionManager: 会话生命周期管理
 *   - WorkspaceManager: 文件系统隔离
 *
 * @module types/session
 */

import type { ToolRegistry, Toolbox, RegisteredTool } from "./tool.js";
import type { SkillRegistry } from "./skill.js";

// ============================================================================
// 会话
// ============================================================================

/**
 * 会话配置选项（创建会话时传入）
 */
export interface SessionOptions {
  /** 会话描述 */
  description?: string;
  /** 继承的父会话 ID（可选，用于会话克隆） */
  parentSessionId?: string;
  /** 自定义工作空间路径（可选） */
  workspacePath?: string;
  /** 初始工具白名单（可选，空则继承全部） */
  allowedTools?: string[];
  /** 初始工具箱列表（可选） */
  toolboxes?: Toolbox[];
}

/**
 * 会话：独立的 Agent 执行上下文
 *
 * 每个会话拥有：
 * - 独立的工具注册表（可从全局克隆并裁剪）
 * - 独立的工作空间路径（可选，否则共享主空间）
 * - 独立的技能注册表（可选升维/降维）
 * - 独立的配置覆盖
 */
export interface Session {
  /** 会话唯一 ID */
  id: string;
  /** 会话描述 */
  description: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 累计对话轮数 */
  turnCount: number;
  /** 会话级工具注册表（从全局克隆） */
  registry: ToolRegistry;
  /** 会话级技能注册表（可选） */
  skillRegistry?: SkillRegistry;
  /** 会话工作空间路径（null = 使用主空间） */
  workspacePath: string | null;
  /** 会话工具箱列表 */
  toolboxes: Toolbox[];
  /** 会话配置覆盖 */
  configOverrides: Record<string, unknown>;
  /** 是否已销毁 */
  destroyed: boolean;
}

/**
 * 会话管理器接口
 */
export interface SessionManager {
  /** 创建或获取会话 */
  getOrCreate(id: string, options?: SessionOptions): Session;
  /** 获取会话（不存在返回 undefined） */
  get(id: string): Session | undefined;
  /** 列出所有活跃会话 */
  list(): Session[];
  /** 销毁会话 */
  destroy(id: string): boolean;
  /** 获取当前活跃会话 ID */
  getActiveId(): string;
  /** 切换活跃会话 */
  setActive(id: string): boolean;
  /** 工具升维（从全局注册表复制工具到会话） */
  promoteTool(sessionId: string, toolName: string): boolean;
  /** 工具降维（从会话注册表移除工具） */
  demoteTool(sessionId: string, toolName: string): boolean;
}
