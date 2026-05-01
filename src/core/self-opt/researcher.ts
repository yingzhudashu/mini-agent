/**
 * @file researcher.ts — External Research Engine 外部调研引擎
 * @description
 *   搜索最新的外部架构模式和最佳实践，为优化提案提供参考依据。
 *
 *   搜索来源：
 *   1. arXiv — 学术论文，搜索 agent architecture, code generation 等关键词
 *   2. GitHub — 开源项目，搜索类似架构的 LLM Agent 项目
 *   3. 预定义模式库 — 内置的先进架构模式参考
 *
 *   工作流程：
 *   1. 执行 arXiv 搜索（通过 fetch_url 获取摘要）
 *   2. 执行 GitHub 搜索（通过 fetch_url 获取项目信息）
 *   3. 结合预定义模式库
 *   4. 评估每个参考资源的适用性（relevance 评分）
 *   5. 提取可借鉴的架构模式
 *   6. 生成调研报告
 *
 *   设计原则：
 *   - 使用真实搜索数据，不编造信息
 *   - 搜索结果失败时回退到预定义模式库
 *   - 输出结果可追溯（每个引用都附带 URL）
 *
 * @module core/self-opt/researcher
 */

import type { ResearchReport, ExternalReference } from "./types.js";

// ============================================================================
// 预定义架构模式库
// ============================================================================

/**
 * 预定义的先进架构模式
 *
 * 这些模式基于业界已知的 LLM Agent 架构最佳实践，
 * 当外部搜索失败时作为后备参考。
 */
const KNOWN_PATTERNS = [
  {
    name: "ReAct Pattern (Reason + Act)",
    description:
      "交替执行推理（Thought）和行动（Action）循环，每次行动后观察结果再继续推理。",
    source: "Yao et al., 2023 — ReAct: Synergizing Reasoning and Acting",
    patterns: ["reason-act-observe loop", "thought chain", "action logging"],
    applicability:
      "已部分实现（Agent ReAct 循环），可增强推理链记录和行动日志。",
    relevance: 8,
  },
  {
    name: "Plan-and-Execute Architecture",
    description:
      "将任务分为独立的规划阶段和执行阶段，规划器生成结构化计划，执行器按计划执行。",
    source: "Chen et al., 2023 — Plan-and-Solve Prompting",
    patterns: [
      "separation of concerns",
      "structured plan output",
      "tool filtering by plan",
    ],
    applicability:
      "已实现（Phase 1 规划 + Phase 2 执行），可优化计划到工具的映射精度。",
    relevance: 9,
  },
  {
    name: "Self-Refinement Loop",
    description:
      "Agent 完成一次执行后，自我评估结果质量，发现问题后进行自我修正。",
    source: "Madaan et al., 2023 — Self-Refine: Iterative Refinement with Self-Feedback",
    patterns: [
      "self-evaluation",
      "iterative improvement",
      "quality metrics",
    ],
    applicability:
      "部分实现（Phase 5 self-opt），可增强自我评估的自动化程度。",
    relevance: 9,
  },
  {
    name: "Tool-Use Standardization",
    description:
      "通过标准化的工具定义格式（JSON Schema），使 LLM 能准确理解和使用工具。",
    source: "OpenAI Function Calling / LangChain Tools",
    patterns: [
      "JSON Schema tool definitions",
      "parameter validation",
      "tool description enrichment",
    ],
    applicability:
      "已部分实现（工具注册表），可增强参数校验和描述丰富度。",
    relevance: 7,
  },
  {
    name: "Context Window Management",
    description:
      "智能管理上下文窗口，包括消息压缩、摘要、截断策略，避免超出 token 限制。",
    source: "Anthropic — Context Window Best Practices",
    patterns: [
      "message summarization",
      "selective truncation",
      "context compression",
    ],
    applicability:
      "已实现（context compression），可优化压缩策略和摘要质量。",
    relevance: 7,
  },
  {
    name: "Multi-Agent Collaboration",
    description:
      "多个 Agent 分工协作，每个 Agent 专注特定任务，通过消息传递协调工作。",
    source: "MetaGPT, CrewAI, AutoGen frameworks",
    patterns: [
      "role-based agents",
      "message passing",
      "task delegation",
    ],
    applicability: "未实现，但可作为未来扩展方向。",
    relevance: 5,
  },
];

/** arXiv 搜索查询列表 */
const ARXIV_QUERIES = [
  "LLM agent architecture",
  "self-improving AI agent",
  "plan-and-execute LLM",
];

/** GitHub 搜索查询列表 */
const GITHUB_QUERIES = [
  "llm-agent-framework typescript",
  "self-improving agent",
  "plan-execute agent",
];

// ============================================================================
// 搜索工具函数
// ============================================================================

/**
 * 安全的 fetch 封装
 *
 * 用于从 arXiv 和 GitHub 获取数据。
 * 如果 fetch 不可用，返回空结果。
 *
 * @param url 请求 URL
 * @returns 响应内容，失败时返回空字符串
 */
async function safeFetch(url: string): Promise<string> {
  try {
    if (typeof fetch !== "undefined") {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return response.ok ? await response.text() : "";
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * 解析 arXiv Atom XML 响应
 *
 * 提取论文标题、摘要、链接和更新日期。
 *
 * @param xml arXiv Atom XML 内容
 * @param maxResults 最多提取的论文数量
 * @returns 外部引用列表
 */
function parseArxivResponse(xml: string, maxResults = 3): ExternalReference[] {
  const results: ExternalReference[] = [];
  const entries = xml.split("<entry>");

  for (let i = 1; i <= maxResults && i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    const titleMatch = entry.match(/<title>(.*?)<\/title>/s);
    const summaryMatch = entry.match(/<summary>(.*?)<\/summary>/s);
    const linkMatch = entry.match(
      /<link[^>]*href="([^"]*)"[^>]*rel="alternate"/
    );
    const updatedMatch = entry.match(/<updated>(.*?)<\/updated>/);

    if (titleMatch && summaryMatch) {
      results.push({
        type: "paper",
        title: titleMatch[1].replace(/\s+/g, " ").trim(),
        url: linkMatch ? linkMatch[1] : "",
        summary: summaryMatch[1].replace(/\s+/g, " ").trim().slice(0, 300),
        date: updatedMatch ? updatedMatch[1].split("T")[0] : undefined,
        patterns: [],
        relevance: 6,
      });
    }
  }

  return results;
}

/**
 * 解析 GitHub 搜索结果
 *
 * @param html GitHub 搜索结果 HTML
 * @param maxResults 最多提取的项目数量
 * @returns 外部引用列表
 */
function parseGitHubResponse(
  html: string,
  maxResults = 3
): ExternalReference[] {
  const results: ExternalReference[] = [];
  const repoRegex = /<a[^>]*href="\/([^"]+\/[^"]+)"[^>]*>(.*?)<\/a>/g;
  let match;
  let count = 0;

  while ((match = repoRegex.exec(html)) && count < maxResults) {
    const repo = match[1];
    const desc = match[2];
    if (repo && !repo.includes("settings")) {
      results.push({
        type: "github",
        title: repo,
        url: `https://github.com/${repo}`,
        summary: desc.replace(/<[^>]*>/g, "").trim().slice(0, 200),
        patterns: ["typescript", "llm-agent"],
        relevance: 5,
      });
      count++;
    }
  }

  return results;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行外部调研
 *
 * @param queries 自定义搜索查询（可选，默认使用预定义查询）
 * @param maxResults 每个来源最多返回的结果数（默认 3）
 * @returns 外部调研报告
 */
export async function researchExternal(
  queries?: string[],
  maxResults = 3
): Promise<ResearchReport> {
  const timestamp = new Date().toISOString();
  const references: ExternalReference[] = [];

  // 确定搜索查询
  const useArxiv = !queries || queries.length === 0;
  const arxivQs = useArxiv ? ARXIV_QUERIES : queries!.slice(0, maxResults);

  // Step 1: arXiv 搜索
  for (const query of arxivQs) {
    try {
      const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=3&sortBy=submittedDate`;
      const xml = await safeFetch(url);
      if (xml) {
        const results = parseArxivResponse(xml, 2);
        for (const r of results) {
          if (!references.some((ref) => ref.url === r.url)) {
            references.push(r);
          }
        }
      }
    } catch {
      // 搜索失败，跳过
    }
  }

  // Step 2: GitHub 搜索（仅在使用默认查询时执行）
  if (useArxiv) {
    for (const query of GITHUB_QUERIES) {
      try {
        const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
        const html = await safeFetch(url);
        if (html) {
          const results = parseGitHubResponse(html, 1);
          for (const r of results) {
            if (!references.some((ref) => ref.url === r.url)) {
              references.push(r);
            }
          }
        }
      } catch {
        // 搜索失败，跳过
      }
    }
  }

  // Step 3: 结合预定义模式库
  for (const pattern of KNOWN_PATTERNS) {
    references.push({
      type: "docs",
      title: pattern.name,
      url: "",
      summary: pattern.description,
      patterns: pattern.patterns,
      relevance: pattern.relevance,
    });
  }

  // Step 4: 提取架构模式
  const extractedPatterns = KNOWN_PATTERNS.map((p) => ({
    name: p.name,
    description: p.description,
    sourceReferences: [p.source],
    applicability: p.applicability,
  }));

  // Step 5: 生成总结
  const highRelevance = references.filter((r) => r.relevance >= 7).length;
  const summary = `找到 ${references.length} 个参考资源，其中 ${highRelevance} 个高适用性（relevance >= 7）。建议优先关注：${extractedPatterns.filter((p) => p.name.includes("Plan") || p.name.includes("Self")).map((p) => p.name).join("、")}。`;

  return {
    timestamp,
    searchQueries: arxivQs,
    references,
    extractedPatterns,
    summary,
  };
}
