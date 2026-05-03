/**
 * @file memory-store.ts — 跨会话记忆持久化存储
 * @description
 *   管理每个会话（chatId/senderId）的长期记忆。
 *
 *   存储结构：
 *   - .mini-agent-state/memory/<sessionId>.json
 *   - 每次对话结束后自动保存
 *   - 下次对话启动时自动加载并注入到 system prompt
 *
 *   记忆内容：
 *   - cumulativeSummary: 累计对话摘要
 *   - keyFacts: 关键事实列表（偏好、约定、重要信息）
 *   - recentEntries: 最近对话条目
 *
 * @module core/memory-store
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionMemory, MemoryStore as IMemoryStore, MemoryEntry } from "./types.js";
import { indexEntry } from "./keyword-index.js";

// ============================================================================
// 路径配置
// ============================================================================

const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  ".mini-agent-state",
  "memory",
);

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function memoryFilePath(sessionId: string): string {
  // 文件名安全处理
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STATE_DIR, `${safe}.json`);
}

// ============================================================================
// 默认记忆
// ============================================================================

function createEmptyMemory(sessionId: string): SessionMemory {
  const now = new Date().toISOString();
  return {
    sessionId,
    cumulativeSummary: "",
    keyFacts: [],
    entries: [],
    totalTurns: 0,
    firstSeen: now,
    lastActive: now,
  };
}

// ============================================================================
// 记忆格式化
// ============================================================================

/**
 * 将记忆格式化为可注入 system prompt 的文本
 */
export function formatMemoryForPrompt(memory: SessionMemory | null): string {
  if (!memory) return "";

  const parts: string[] = [];

  // 关键事实（最重要的信息）
  if (memory.keyFacts.length > 0) {
    parts.push("## 关键记忆");
    for (const fact of memory.keyFacts.slice(-10)) {
      parts.push(`- ${fact}`);
    }
  }

  // 累计摘要
  if (memory.cumulativeSummary) {
    parts.push("## 之前的对话摘要");
    parts.push(memory.cumulativeSummary);
  }

  // 最近条目
  if (memory.entries.length > 0) {
    parts.push("## 最近的对话");
    for (const entry of memory.entries.slice(-5)) {
      parts.push(
        `[${entry.timestamp.slice(0, 16)}] 用户: ${entry.userSnippet} → 摘要: ${entry.summary}`,
      );
    }
  }

  if (parts.length === 0) return "";

  return `【历史记忆】\n\n${parts.join("\n\n")}\n\n【记忆结束】`;
}

/**
 * 从对话中提取关键事实（简单启发式）
 * 识别 "记住"、"以后"、"偏好"、"默认" 等关键词的句子
 */
export function extractFacts(text: string): string[] {
  const facts: string[] = [];

  // 匹配模式：包含记忆性关键词的句子
  const patterns = [
    /记住[：:，,。]\s*(.+)/,
    /以后[都]?[要]?[：:，,。]\s*(.+)/,
    /偏好[是]?[：:，,。]\s*(.+)/,
    /默认[是]?[：:，,。]\s*(.+)/,
    /不[要喜欢]([^.。]+)/,
    /喜[欢好]([^.。]+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const fact = match[1].trim().slice(0, 200);
      if (fact.length > 2) {
        facts.push(fact);
      }
    }
  }

  return facts;
}

/**
 * 生成单轮对话摘要（简单版，不调用 LLM）
 * 从工具调用和用户消息中提取关键信息
 */
export function generateTurnSummary(
  userMessage: string,
  toolCalls: Array<{ name: string; args: string; result?: string }>,
  finalReply: string,
): string {
  const parts: string[] = [];

  // 用户意图（取前 50 字符）
  const intent = userMessage.trim().slice(0, 50);
  if (intent) parts.push(`用户${intent}`);

  // 工具使用
  if (toolCalls.length > 0) {
    const tools = toolCalls.map((tc) => tc.name).join(", ");
    parts.push(`使用了 ${tools}`);
  }

  // 结果摘要
  if (finalReply) {
    const summary = finalReply.trim().slice(0, 100);
    if (summary) parts.push(`回复: ${summary}`);
  }

  return parts.join("，");
}

// ============================================================================
// 记忆存储实现
// ============================================================================

const memoryCache = new Map<string, SessionMemory>();

export const memoryStore: IMemoryStore = {
  /**
   * 加载会话记忆
   */
  async load(sessionId: string): Promise<SessionMemory | null> {
    // 先查缓存
    if (memoryCache.has(sessionId)) {
      return memoryCache.get(sessionId)!;
    }

    try {
      ensureStateDir();
      const filePath = memoryFilePath(sessionId);
      if (!fs.existsSync(filePath)) return null;

      const raw = fs.readFileSync(filePath, "utf-8");
      const memory = JSON.parse(raw) as SessionMemory;
      memoryCache.set(sessionId, memory);
      return memory;
    } catch {
      return null;
    }
  },

  /**
   * 保存会话记忆
   */
  async save(memory: SessionMemory): Promise<void> {
    try {
      ensureStateDir();
      const filePath = memoryFilePath(memory.sessionId);
      fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
      memoryCache.set(memory.sessionId, memory);
    } catch (err) {
      console.error(`[memory-store] 保存失败 [${memory.sessionId}]:`, err);
    }
  },

  /**
   * 更新摘要和事实
   */
  async updateSummary(
    sessionId: string,
    summary: string,
    facts: string[],
  ): Promise<void> {
    const memory = await this.load(sessionId);
    if (!memory) return;

    // 更新累计摘要（保留最近 2000 字符）
    if (summary) {
      const newSummary = memory.cumulativeSummary
        ? `${memory.cumulativeSummary}\n- ${summary}`
        : summary;
      memory.cumulativeSummary = newSummary.slice(-2000);
    }

    // 更新关键事实（去重，最多保留 20 条）
    for (const fact of facts) {
      const normalized = fact.toLowerCase().trim();
      const exists = memory.keyFacts.some(
        (f) => f.toLowerCase().trim() === normalized,
      );
      if (!exists) {
        memory.keyFacts.push(fact);
      }
    }
    if (memory.keyFacts.length > 20) {
      memory.keyFacts = memory.keyFacts.slice(-20);
    }

    memory.lastActive = new Date().toISOString();
    await this.save(memory);
  },

  /**
   * 添加对话条目
   */
  async addEntry(
    sessionId: string,
    entry: {
      timestamp: string;
      userSnippet: string;
      summary: string;
      facts?: string[];
    },
  ): Promise<void> {
    const memory = await this.load(sessionId);
    if (!memory) return;

    const fullEntry: MemoryEntry = {
      timestamp: entry.timestamp,
      userSnippet: entry.userSnippet,
      summary: entry.summary,
      facts: entry.facts ?? [],
    };
    memory.entries.push(fullEntry);
    memory.totalTurns++;

    // 只保留最近 20 条
    if (memory.entries.length > 20) {
      memory.entries = memory.entries.slice(-20);
    }

    memory.lastActive = new Date().toISOString();
    await this.save(memory);

    // Layer 3: 索引到关键词倒排索引
    indexEntry(sessionId, fullEntry);
  },
};
