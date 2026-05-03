/**
 * @file keyword-index.ts — Layer 3: 轻量语义记忆检索
 * @description
 *   基于关键词的倒排索引，实现跨会话的语义记忆检索。
 *   不需要向量数据库，纯文本匹配，轻量高效。
 *
 *   工作原理：
 *   1. 每次保存记忆时，自动提取关键词（中文分词 + 英文词元化）
 *   2. 建立 关键词 → [记忆条目] 的倒排索引
 *   3. 用户新输入时，提取关键词，检索相关记忆
 *   4. 按相关性排序，只取 Top-N 条注入上下文
 *
 *   分词策略（简化版，无外部依赖）：
 *   - 中文：按字符 n-gram（2-gram + 3-gram）
 *   - 英文：按空格和标点分词，去停用词
 *   - 混合：同时应用两种策略
 *
 *   存储：.mini-agent-state/memory/keyword-index.json
 *
 * @module core/keyword-index
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryEntry, MemoryEntryInput } from "./types.js";

// ============================================================================
// 路径
// ============================================================================

const STATE_DIR = path.join(
  process.env.MINI_AGENT_STATE || process.cwd(),
  ".mini-agent-state",
  "memory",
);
const INDEX_FILE = path.join(STATE_DIR, "keyword-index.json");

// ============================================================================
// 停用词
// ============================================================================

const STOP_WORDS = new Set([
  // 中文
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
  "自己", "这", "那", "吗", "吧", "呢", "啊", "呀", "哦", "嗯", "哈",
  // 英文
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "shall", "of", "in", "to", "for", "with", "on", "at",
  "from", "by", "as", "into", "through", "during", "before", "after",
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "not", "only", "own", "same", "than", "too", "very", "just", "because",
  "i", "me", "my", "myself", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "what", "which", "who",
  "whom", "this", "that", "these", "those", "am",
]);

// ============================================================================
// 分词
// ============================================================================

/**
 * 提取关键词（简化版中文分词 + 英文词元化）
 */
export function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();

  // 英文分词
  const englishWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  for (const w of englishWords) {
    keywords.add(w);
  }

  // 中文 2-gram + 3-gram
  const chineseChars = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < chineseChars.length - 1; i++) {
    // 2-gram
    if (i + 1 < chineseChars.length) {
      const bigram = chineseChars.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) keywords.add(bigram);
    }
    // 3-gram
    if (i + 2 < chineseChars.length) {
      const trigram = chineseChars.slice(i, i + 3);
      keywords.add(trigram);
    }
  }

  return Array.from(keywords);
}

// ============================================================================
// 倒排索引
// ============================================================================

/**
 * 关键词索引条目
 */
interface IndexEntry {
  /** 关键词 */
  keyword: string;
  /** 关联的记忆条目列表 [{ sessionId, timestamp, snippet }] */
  references: Array<{
    sessionId: string;
    timestamp: string;
    userSnippet: string;
    summary: string;
    facts: string[];
    /** 该关键词在此条目中的权重 */
    weight: number;
  }>;
}

/**
 * 磁盘索引格式
 */
interface DiskIndex {
  version: number;
  updatedAt: string;
  totalEntries: number;
  /** 关键词 → 索引条目 */
  index: Record<string, Omit<IndexEntry, "keyword">>;
}

/**
 * 内存索引（启动时加载）
 */
const memoryIndex = new Map<string, IndexEntry>();
let isLoaded = false;

// ============================================================================
// 索引管理
// ============================================================================

/**
 * 从磁盘加载索引
 */
export function loadIndex(): void {
  try {
    if (!fs.existsSync(INDEX_FILE)) {
      isLoaded = true;
      return;
    }

    const raw = fs.readFileSync(INDEX_FILE, "utf-8");
    const disk = JSON.parse(raw) as DiskIndex;

    memoryIndex.clear();
    for (const [keyword, data] of Object.entries(disk.index)) {
      memoryIndex.set(keyword, { keyword, references: data.references });
    }

    isLoaded = true;
  } catch (err) {
    console.warn("[keyword-index] 加载索引失败，重建中...", err);
    memoryIndex.clear();
    isLoaded = true;
  }
}

/**
 * 保存索引到磁盘
 */
export function saveIndex(): void {
  try {
    ensureDir();
    const disk: DiskIndex = {
      version: 1,
      updatedAt: new Date().toISOString(),
      totalEntries: memoryIndex.size,
      index: Object.fromEntries(
        Array.from(memoryIndex.entries()).map(([k, v]) => [k, { references: v.references }]),
      ),
    };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(disk, null, 2), "utf-8");
  } catch (err) {
    console.error("[keyword-index] 保存索引失败:", err);
  }
}

/**
 * 确保目录存在
 */
function ensureDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

// ============================================================================
// 索引操作
// ============================================================================

/**
 * 索引一条记忆条目
 */
export function indexEntry(sessionId: string, entry: MemoryEntryInput | MemoryEntry): void {
  if (!isLoaded) loadIndex();

  // 组合文本用于提取关键词
  const fullText = [
    entry.userSnippet,
    entry.summary,
    ...(entry.facts || []),
  ].join(" ");

  const keywords = extractKeywords(fullText);

  for (const keyword of keywords) {
    let idxEntry = memoryIndex.get(keyword);
    if (!idxEntry) {
      idxEntry = { keyword, references: [] };
      memoryIndex.set(keyword, idxEntry);
    }

    // 检查是否已存在相同会话 + 时间戳的引用
    const exists = idxEntry.references.some(
      (r) => r.sessionId === sessionId && r.timestamp === entry.timestamp,
    );
    if (!exists) {
      idxEntry.references.push({
        sessionId,
        timestamp: entry.timestamp,
        userSnippet: entry.userSnippet,
        summary: entry.summary,
        facts: entry.facts || [],
        weight: 1,
      });
    }
  }
}

/**
 * 检索相关记忆
 * @param query 用户查询文本
 * @param limit 最多返回条数
 * @param recentMinutes 可选：只检索最近 N 分钟的记忆（0 = 不限制）
 */
export function searchRelevantMemory(
  query: string,
  limit: number = 10,
  recentMinutes: number = 0,
): Array<{
  sessionId: string;
  timestamp: string;
  userSnippet: string;
  summary: string;
  facts: string[];
  score: number;
}> {
  if (!isLoaded) loadIndex();

  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return [];

  // 时间过滤
  const cutoffTime = recentMinutes > 0
    ? new Date(Date.now() - recentMinutes * 60 * 1000).toISOString()
    : null;

  // 为每个候选条目计算相关性分数
  const scores = new Map<string, {
    sessionId: string;
    timestamp: string;
    userSnippet: string;
    summary: string;
    facts: string[];
    score: number;
    matchCount: number;
  }>();

  for (const keyword of queryKeywords) {
    const idxEntry = memoryIndex.get(keyword);
    if (!idxEntry) continue;

    for (const ref of idxEntry.references) {
      // 时间过滤
      if (cutoffTime && ref.timestamp < cutoffTime) continue;

      const key = `${ref.sessionId}:${ref.timestamp}`;
      let entry = scores.get(key);
      if (!entry) {
        entry = {
          sessionId: ref.sessionId,
          timestamp: ref.timestamp,
          userSnippet: ref.userSnippet,
          summary: ref.summary,
          facts: ref.facts,
          score: 0,
          matchCount: 0,
        };
        scores.set(key, entry);
      }

      // 分数 = 匹配关键词数 + 3-gram 权重更高
      const weight = keyword.length >= 3 ? 1.5 : 1.0;
      entry.score += weight;
      entry.matchCount++;
    }
  }

  // 排序：先按匹配数，再按分数
  const results = Array.from(scores.values())
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.score - a.score;
    })
    .slice(0, limit);

  return results;
}

/**
 * 格式化检索结果为可注入 system prompt 的文本
 */
export function formatSearchResults(
  results: Array<{
    sessionId: string;
    timestamp: string;
    userSnippet: string;
    summary: string;
    facts: string[];
    score: number;
  }>,
): string {
  if (results.length === 0) return "";

  const parts: string[] = [];
  parts.push("## 相关记忆检索");

  for (const r of results) {
    const time = r.timestamp.slice(0, 16).replace("T", " ");
    parts.push(`- [${time}] ${r.userSnippet} → ${r.summary}`);
    if (r.facts.length > 0) {
      for (const f of r.facts.slice(0, 3)) {
        parts.push(`    事实: ${f}`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * 获取索引统计
 */
export function getIndexStats(): {
  totalKeywords: number;
  totalReferences: number;
  topKeywords: Array<{ keyword: string; count: number }>;
} {
  if (!isLoaded) loadIndex();

  let totalRefs = 0;
  const keywordCounts: Array<{ keyword: string; count: number }> = [];

  for (const [keyword, entry] of memoryIndex.entries()) {
    totalRefs += entry.references.length;
    keywordCounts.push({ keyword, count: entry.references.length });
  }

  keywordCounts.sort((a, b) => b.count - a.count);

  return {
    totalKeywords: memoryIndex.size,
    totalReferences: totalRefs,
    topKeywords: keywordCounts.slice(0, 20),
  };
}

/**
 * 清理过期索引（超过 N 天的条目）
 */
export function pruneExpiredIndex(daysOld: number = 30): number {
  if (!isLoaded) loadIndex();

  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  let removedCount = 0;

  for (const [, entry] of memoryIndex.entries()) {
    const before = entry.references.length;
    entry.references = entry.references.filter((r) => r.timestamp >= cutoff);
    removedCount += before - entry.references.length;
  }

  // 清理空关键词
  for (const [keyword, entry] of memoryIndex.entries()) {
    if (entry.references.length === 0) {
      memoryIndex.delete(keyword);
    }
  }

  if (removedCount > 0) {
    saveIndex();
  }

  return removedCount;
}
