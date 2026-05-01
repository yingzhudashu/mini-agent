/**
 * @file researcher.ts — External Research 外部调研引擎
 * @description
 *   搜索当前先进的 Agent 架构和实现方案。
 *
 *   调研维度：
 *   1. arXiv 论文：搜索 self-evolving agent, self-improving architecture 等关键词
 *   2. GitHub 项目：搜索 self-improving-ai, auto-research 等话题
 *   3. 提取可借鉴的架构模式
 *
 *   设计原则：
 *   - 使用 fetch 获取真实数据，禁止编造
 *   - 每次调研结果可追溯（带 URL 和时间戳）
 *   - 提取的模式必须与 Mini Agent 架构相关
 *
 * @module core/self-opt/researcher
 */

import * as https from "node:https";
import type { ResearchReport, ExternalReference } from "./types.js";

// ============================================================================
// 搜索配置
// ============================================================================

/** 搜索关键词列表 */
const SEARCH_QUERIES = [
  "self-evolving LLM agent architecture",
  "self-improving agent code generation",
  "agentic architecture tree search",
  "runtime code generation agent",
  "agent self-extension architecture",
];

/** arXiv API 端点 */
const ARXIV_API = "https://export.arxiv.org/api/query";

/** GitHub Topics API */
const GITHUB_TOPICS_URL = "https://api.github.com/search/repositories";

// ============================================================================
// HTTP 工具
// ============================================================================

interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** 简易 HTTPS GET（不依赖外部库） */
function httpGet(url: string, opts?: HttpOptions | number): Promise<string> {
  const options: HttpOptions = typeof opts === "number" ? { timeoutMs: opts } : opts || {};
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: options.timeoutMs ?? 15000, headers: options.headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timeout: ${url}`));
    });
  });
}

/** 解析 URL 参数 */
function buildUrl(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}?${qs}`;
}

// ============================================================================
// arXiv 搜索
// ============================================================================

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  updated: string;
  authors: string[];
  link: string;
}

/** 解析 arXiv Atom XML 响应 */
function parseArxivXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const extract = (tag: string) => {
      const m = entryXml.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`));
      return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
    };

    const id = extract("id");
    const title = extract("title").replace(/\s+/g, " ").trim();
    const summary = extract("summary").replace(/\s+/g, " ").trim();
    const published = extract("published");
    const updated = extract("updated");

    // 提取作者
    const authors: string[] = [];
    const authorRegex = /<name>([^<]+)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
      authors.push(authorMatch[1]);
    }

    // 提取链接（优先 alternate）
    let link = id;
    const linkRegex = /<link[^>]*href="([^"]+)"[^>]*\/>/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(entryXml)) !== null) {
      if (linkMatch[1].includes("arxiv.org/abs/")) {
        link = linkMatch[1];
        break;
      }
    }

    entries.push({ id, title, summary, published, updated, authors, link });
  }

  return entries;
}

/** 搜索 arXiv */
async function searchArxiv(query: string, maxResults = 5): Promise<ExternalReference[]> {
  const url = buildUrl(ARXIV_API, {
    search_query: `all:${query}`,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending",
  });

  try {
    const xml = await httpGet(url);
    const entries = parseArxivXml(xml);

    return entries.map((e) => ({
      type: "paper" as const,
      title: e.title,
      url: e.link,
      summary: e.summary.slice(0, 500),
      date: e.published.slice(0, 10),
      authors: e.authors.slice(0, 3).join(", "),
      patterns: extractPatternsFromSummary(e.summary),
      relevance: scoreRelevance(e.summary + " " + e.title, query),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// GitHub 搜索
// ============================================================================

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  updated_at: string;
  topics: string[];
  language: string;
}

/** 搜索 GitHub 仓库 */
async function searchGitHub(query: string, maxResults = 5): Promise<ExternalReference[]> {
  const url = buildUrl(GITHUB_TOPICS_URL, {
    q: `${query} stars:>10 pushed:>2024-01-01`,
    sort: "stars",
    order: "desc",
    per_page: String(maxResults),
  });

  try {
    const json = await httpGet(url, {
      timeoutMs: 15000,
      headers: { "User-Agent": "Mini-Agent-Self-Opt" },
    });
    const data = JSON.parse(json);
    const items: GitHubRepo[] = data.items || [];

    return items.map((repo) => ({
      type: "github" as const,
      title: repo.full_name,
      url: repo.html_url,
      summary: repo.description || "No description",
      date: repo.updated_at.slice(0, 10),
      patterns: repo.topics.slice(0, 5),
      relevance: scoreRelevance(
        `${repo.description || ""} ${repo.topics.join(" ")}`,
        query
      ),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// 模式提取与评分
// ============================================================================

/** 架构模式关键词 */
const PATTERN_KEYWORDS = [
  "tree search",
  "self-evolving",
  "self-improving",
  "meta-prompt",
  "reflection",
  "self-correction",
  "code generation",
  "test-driven",
  "feedback loop",
  "experience replay",
  "skill extraction",
  "playbook",
  "planning",
  "tool selection",
  "context compression",
  "loop detection",
  "verification",
  "sandbox",
  "runtime extension",
  "modular",
];

/** 从摘要中提取可能的架构模式 */
function extractPatternsFromSummary(summary: string): string[] {
  const patterns: string[] = [];
  const lower = summary.toLowerCase();
  for (const keyword of PATTERN_KEYWORDS) {
    if (lower.includes(keyword)) {
      patterns.push(keyword);
    }
  }
  return patterns.slice(0, 5);
}

/** 计算与搜索查询的相关性评分 (1-10) */
function scoreRelevance(text: string, query: string): number {
  const lower = text.toLowerCase();
  const queryWords = query.toLowerCase().split(/\s+/);
  let score = 0;

  for (const word of queryWords) {
    if (word.length < 3) continue;
    if (lower.includes(word)) score += 2;
  }

  // 加分项
  for (const keyword of PATTERN_KEYWORDS) {
    if (lower.includes(keyword)) score += 1;
  }

  return Math.min(10, Math.max(1, score));
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行外部调研
 *
 * @param queries 自定义搜索关键词（可选，默认使用预定义列表）
 * @param maxResultsPerQuery 每个查询的最大结果数
 * @returns 调研报告
 */
export async function researchExternal(
  queries?: string[],
  maxResultsPerQuery = 3
): Promise<ResearchReport> {
  const searchQueries = queries || SEARCH_QUERIES;
  const allReferences: ExternalReference[] = [];

  // ── 并行搜索 arXiv 和 GitHub ──
  for (const query of searchQueries) {
    const [arxivResults, githubResults] = await Promise.all([
      searchArxiv(query, maxResultsPerQuery),
      searchGitHub(query, maxResultsPerQuery),
    ]);

    allReferences.push(...arxivResults, ...githubResults);
  }

  // 去重（按 URL）
  const seen = new Set<string>();
  const uniqueRefs = allReferences.filter((ref) => {
    if (seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  });

  // 按相关性排序
  uniqueRefs.sort((a, b) => b.relevance - a.relevance);

  // ── 提取架构模式 ──
  const patternMap = new Map<string, { description: string; sources: string[] }>();

  for (const ref of uniqueRefs) {
    for (const pattern of ref.patterns) {
      const existing = patternMap.get(pattern);
      if (existing) {
        if (!existing.sources.includes(ref.title)) {
          existing.sources.push(ref.title);
        }
      } else {
        patternMap.set(pattern, {
          description: generatePatternDescription(pattern),
          sources: [ref.title],
        });
      }
    }
  }

  const extractedPatterns = Array.from(patternMap.entries())
    .map(([name, data]) => ({
      name,
      description: data.description,
      sourceReferences: data.sources.slice(0, 3),
      applicability: assessApplicability(name),
    }))
    .sort((a, b) => b.sourceReferences.length - a.sourceReferences.length)
    .slice(0, 10);

  // ── 生成总结 ──
  const summary = generateSummary(uniqueRefs.length, extractedPatterns);

  return {
    timestamp: new Date().toISOString(),
    searchQueries: searchQueries,
    references: uniqueRefs.slice(0, 20),
    extractedPatterns,
    summary,
  };
}

/** 生成模式描述 */
function generatePatternDescription(pattern: string): string {
  const descriptions: Record<string, string> = {
    "tree search": "使用树搜索在解空间探索最优方案，类似 AIDE 的 agentic tree search",
    "self-evolving": "Agent 能够自主演化代码、配置和能力，不受设计时限制",
    "self-improving": "从经验中学习并改进自身行为，无需人工干预",
    "meta-prompt": "Agent 能够生成和优化自身的 prompt/system instructions",
    "reflection": "执行后反思结果，识别错误并改进策略",
    "self-correction": "检测并自动修正执行过程中的错误",
    "code generation": "运行时生成代码实现新功能",
    "test-driven": "先生成测试用例，再实现功能，确保正确性",
    "feedback loop": "通过反馈循环持续优化行为",
    "experience replay": "重放成功经验加速学习",
    "skill extraction": "从成功执行中提取可复用技能",
    "playbook": "将最佳实践固化为可执行的 playbook",
    "planning": "执行前先规划步骤，减少试错",
    "tool selection": "智能选择最相关的工具，减少上下文占用",
    "context compression": "压缩对话历史，保留关键信息",
    "loop detection": "检测并防止无限循环",
    "verification": "执行后验证结果正确性",
    "sandbox": "在安全沙箱中执行不可信代码",
    "runtime extension": "运行时扩展新功能和工具",
    "modular": "模块化架构，支持热插拔扩展",
  };
  return descriptions[pattern] || `架构模式: ${pattern}`;
}

/** 评估模式对 Mini Agent 的适用性 */
function assessApplicability(pattern: string): string {
  const applicability: Record<string, string> = {
    "tree search": "可用于优化阶段的方案探索，替代单一实现路径",
    "self-evolving": "核心目标，需要实现提案-实施-验证闭环",
    "self-improving": "核心目标，需要持久化学习成果",
    "reflection": "可集成到执行循环中，失败后自动反思",
    "test-driven": "推荐用于 self-opt，先写测试再改代码",
    "feedback loop": "已有性能监控，可扩展为优化反馈",
    "skill extraction": "可从成功执行中自动提取新技能",
    "verification": "修改后自动编译+测试验证，确保不破坏",
    "sandbox": "已有沙箱实现，可扩展用于 self-opt 代码执行",
    "modular": "已有技能系统，符合此模式",
  };
  return applicability[pattern] || "需进一步评估适用性";
}

/** 生成调研总结 */
function generateSummary(refCount: number, patterns: { name: string }[]): string {
  if (refCount === 0) {
    return "未能获取外部调研数据，可能因网络限制或 API 不可用。建议手动查阅最新论文。";
  }

  const topPatterns = patterns.slice(0, 5).map((p) => p.name);
  return `共找到 ${refCount} 个相关资源。主流架构模式包括：${topPatterns.join("、")}。建议优先关注 self-evolving、test-driven 和 verification 模式。`;
}
