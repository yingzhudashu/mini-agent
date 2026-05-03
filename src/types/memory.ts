/**
 * @file memory.ts — 跨会话记忆类型
 * @description
 *   v4.6 新增：支持跨会话持久化记忆。
 *
 *   记忆架构：
 *   - MemoryEntry: 单轮对话提取的信息
 *   - SessionMemory: 完整的会话记忆数据
 *   - MemoryStore: 记忆存储接口
 *
 * @module types/memory
 */

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
  /** 会话唯一标识（chatId + senderId） */
  sessionId: string;
  /** 运行累计摘要 */
  cumulativeSummary: string;
  /** 关键事实列表（去重后保留） */
  keyFacts: string[];
  /** 历史条目列表（最多 N 条） */
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
