/**
 * @file memory.ts — 记忆与会话管理类型
 * @description
 *   v4.6+ 新增：跨会话持久化记忆 + 多会话管理。
 *
 * @module types/memory
 */

import type { ToolRegistry, Toolbox, RegisteredTool } from "./tool.js";
import type { SkillRegistry } from "./skill.js";

// ============================================================================
// 记忆条目
// ============================================================================

/**
 * 记忆条目：从单轮对话中提取的信息
 */
export interface MemoryEntry {
  /** 时间戳 */
  timestamp: string;
  /** 用户消息摘要（前 100 字符） */
  userSnippet: string;
  /** 本轮对话摘要 */
  summary: string;
  /** 提取的关键事实 */
  facts: string[];
}

/**
 * 简化的条目输入（用于 addEntry，facts 可选）
 */
export interface MemoryEntryInput {
  /** 时间戳 */
  timestamp: string;
  /** 用户消息摘要 */
  userSnippet: string;
  /** 本轮对话摘要 */
  summary: string;
  /** 关键事实（可选） */
  facts?: string[];
}

// ============================================================================
// 会话记忆
// ============================================================================

/**
 * 会话记忆：持久化的跨会话记忆数据
 */
export interface SessionMemory {
  /** 会话唯一标识 */
  sessionId: string;
  /** 运行累计摘要 */
  cumulativeSummary: string;
  /** 关键事实列表 */
  keyFacts: string[];
  /** 历史条目列表 */
  entries: MemoryEntry[];
  /** 累计对话轮数 */
  totalTurns: number;
  /** 首次活跃时间 */
  firstSeen: string;
  /** 最后活跃时间 */
  lastActive: string;
  /** 关联的聊天室 ID */
  chatId?: string;
  /** 关联的发送者 ID */
  senderId?: string;
}

// ============================================================================
// 记忆存储接口
// ============================================================================

/**
 * 记忆存储接口
 */
export interface MemoryStore {
  /** 加载会话记忆 */
  load(sessionKey: string): Promise<SessionMemory | null>;
  /** 保存会话记忆 */
  save(memory: SessionMemory): Promise<void>;
  /** 更新摘要和事实 */
  updateSummary(sessionKey: string, summary: string, facts: string[]): Promise<void>;
  /** 添加条目 */
  addEntry(sessionKey: string, entry: MemoryEntryInput): Promise<void>;
}

// ============================================================================
// 会话管理（v4.7）
// ============================================================================

/**
 * 会话配置选项
 */
export interface SessionOptions {
  /** 会话描述 */
  description?: string;
  /** 继承的父会话 ID */
  parentSessionId?: string;
  /** 自定义工作空间路径 */
  workspacePath?: string;
  /** 初始工具白名单 */
  allowedTools?: string[];
  /** 初始工具箱列表 */
  toolboxes?: Toolbox[];
}

/**
 * 会话：独立的 Agent 执行上下文
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
  /** 会话级工具注册表 */
  registry: ToolRegistry;
  /** 会话级技能注册表 */
  skillRegistry?: SkillRegistry;
  /** 会话工作空间路径 */
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
  /** 获取会话 */
  get(id: string): Session | undefined;
  /** 列出所有活跃会话 */
  list(): Session[];
  /** 销毁会话 */
  destroy(id: string): boolean;
  /** 获取当前活跃会话 ID */
  getActiveId(): string;
  /** 切换活跃会话 */
  setActive(id: string): boolean;
  /** 工具升维 */
  promoteTool(sessionId: string, toolName: string): boolean;
  /** 工具降维 */
  demoteTool(sessionId: string, toolName: string): boolean;
}
