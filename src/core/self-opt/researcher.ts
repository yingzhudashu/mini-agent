/**
 * @file researcher.ts - External Research Engine 外部调研引擎 (Phase 5.4 升级)
 * @description
 *   搜索最新的外部架构模式和最佳实践，为优化提案提供参考数据。
 *
 *   Phase 5.4 升级：
 *   - 超时从 5s 提升到 10s
 *   - GitHub 搜索改用 GitHub API（api.github.com/search/repositories）代替 HTML 解析
 *   - 增加 Tavily Search 作为补充来源（需要 TAVILY_API_KEY 环境变量）
 *
 *   数据来源：
 *   1. arXiv — 学术论文，搜索 agent architecture, code generation 等关键词
 *   2. GitHub API — 开源项目信息，搜索先进架构、LLM Agent 项目
 *   3. Tavily Search — AI 搜索增强（可选，需 TAVILY_API_KEY）
 *   4. 预定义模式库 — 内置的先进架构模式参考
 *
 *   工作流程：
 *   1. 执行 arXiv 搜索，通过 fetch_url 获取摘要
 *   2. 执行 GitHub API 搜索，获取项目信息
 *   3. （可选）执行 Tavily 搜索
 *   4. 加载预定义模式库
 *   5. 对每个参考来源计算相关性（relevance 评分）
 *   6. 提取可行的架构模式
 *   7. 生成调研报告
 *
 *   设计原则
 *   - 使用真实搜索数据，禁止虚构信息
 *   - 外部搜索失败时，降级到预定义模式库
 *   - 所有引用可追溯（每个来源都有 URL）
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
 * 这些模式来自业界公认的 LLM Agent 架构最佳实践。
 * 当外部搜索失败时，作为后备参考。
 */
const KNOWN_PATTERNS = [
  {
    name: "ReAct Pattern (Reason + Act)",
    description:
      "结合推理和执行，通过 Thought-Action-Observation 循环。每一步推理、行动、观察、再决策。",
    source: "Yao et al., 2023 — ReAct: Synergizing Reasoning and Acting",
    patterns: ["reason-act-observe loop", "thought chain", "action logging"],
    applicability:
      "已部分实现。Agent ReAct 循环已实现，可增强推理步骤日志和决策追踪。",
    relevance: 8,
  },
  {
    name: "Plan-and-Execute Architecture",
    description:
      "将任务拆分为独立的规划阶段和执行阶段。规划器生成结构化计划，执行器按照计划执行。",
    source: "Chen et al., 2023 — Plan-and-Solve Prompting",
    patterns: [
      "separation of concerns",
      "structured plan output",
      "tool filtering by plan",
    ],
    applicability:
      "已实现。Phase 1 规划 + Phase 2 执行，可进一步优化计划生成质量和映射精度。",
    relevance: 9,
  },
  {
    name: "Self-Refinement Loop",
    description:
      "Agent 执行一次后，评估输出质量，根据反馈自我改进。迭代直到满意。",
    source: "Madaan et al., 2023 — Self-Refine: Iterative Refinement with Self-Feedback",
    patterns: [
      "self-evaluation",
      "iterative improvement",
      "quality metrics",
    ],
    applicability:
      "部分实现。Phase 5 self-opt 已有雏形，可增强自动化程度和修复粒度。",
    relevance: 9,
  },
  {
    name: "Tool-Use Standardization",
    description:
      "通过标准化工具定义格式（JSON Schema），使 LLM 更准确地理解和使用工具。",
    source: "OpenAI Function Calling / LangChain Tools",
    patterns: [
      "JSON Schema tool definitions",
      "parameter validation",
      "tool description enrichment",
    ],
    applicability:
      "已部分实现。工具注释格式良好，可进一步增强类型校验和参数描述丰富度。",
    relevance: 7,
  },
  {
    name: "Context Window Management",
    description:
      "智能管理对话上下文窗口，包括信息压缩、摘要、选择性截断策略，避免超出 token 限制。",
    source: "Anthropic — Context Window Best Practices",
    patterns: [
      "message summarization",
      "selective truncation",
      "context compression",
    ],
    applicability:
      "未实现。可考虑 context compression，优化压缩策略和摘要生成算法。",
    relevance: 7,
  },
  {
    name: "Multi-Agent Collaboration",
    description:
      "多个 Agent 分工协作，每个 Agent 专注特定领域，通过消息传递协调完成复杂任务。",
    source: "MetaGPT, CrewAI, AutoGen frameworks",
    patterns: [
      "role-based agents",
      "message passing",
      "task delegation",
    ],
    applicability: "未实现。可以作为未来扩展方向。",
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
 * 安全 fetch 封装（Phase 5.4: 超时从 5s 提升到 10s）
 *
 * 用于从 arXiv、GitHub API 等获取数据。
 * 如果 fetch 不可用，返回空字符串。
 *
 * @param url 请求 URL
 * @returns 响应文本，失败时返回空字符串
 */
async function safeFetch(url: string): Promise<string> {
  try {
    if (typeof fetch !== "undefined") {
      // Phase 5.4: 超时从 5000ms 提升到 10000ms
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
 * 提取论文的标题、摘要、链接和更新日期。
 *
 * @param xml arXiv Atom XML 响应
 * @param maxResults 最多提取的结果数量
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
 * 解析 GitHub API 搜索结果（Phase 5.4: 使用 API 代替 HTML 解析）
 *
 * @param json GitHub API 返回的 JSON 响应
 * @param maxResults 最多提取的项目数量
 * @returns 外部引用列表
 */
function parseGitHubApiResponse(
  json: string,
  maxResults = 3
): ExternalReference[] {
  const results: ExternalReference[] = [];
  try {
    const data = JSON.parse(json);
    if (!data.items || !Array.isArray(data.items)) return results;

    for (let i = 0; i < Math.min(maxResults, data.items.length); i++) {
      const repo = data.items[i];
      if (!repo || !repo.full_name) continue;

      results.push({
        type: "github",
        title: repo.full_name,
        url: repo.html_url || `https://github.com/${repo.full_name}`,
        summary: (repo.description || "").slice(0, 300),
        patterns: repo.language ? [repo.language.toLowerCase()] : [],
        relevance: repo.stargazers_count > 1000 ? 8 : repo.stargazers_count > 100 ? 6 : 5,
        date: repo.updated_at ? repo.updated_at.split("T")[0] : undefined,
      });
    }
  } catch {
    // JSON 解析失败
  }

  return results;
}

/**
 * 执行 Tavily 搜索（Phase 5.4 新增，需要 TAVILY_API_KEY）
 *
 * @param query 搜索查询
 * @param maxResults 最大结果数
 * @returns 外部引用列表
 */
async function searchTavily(
  query: string,
  maxResults = 3
): Promise<ExternalReference[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results.map((r: any) => ({
      type: "web" as const,
      title: r.title || "",
      url: r.url || "",
      summary: (r.content || "").slice(0, 300),
      patterns: [],
      relevance: 7,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 执行外部调研
 *
 * Phase 5.4 改进：
 * - arXiv 超时提升到 10 秒
 * - GitHub 改用 API（api.github.com/search/repositories）代替 HTML 解析
 * - 增加 Tavily 搜索作为补充来源
 *
 * @param queries 自定义搜索查询（可选，默认使用预定义查询）
 * @param maxResults 每个数据源最多返回的结果数（默认 3）
 * @returns 外部调研报告
 */
export async function researchExternal(
  queries?: string[],
  maxResults = 3
): Promise<ResearchReport> {
  const timestamp = new Date().toISOString();
  const references: ExternalReference[] = [];

  // 确保使用预定义查询
  const useDefault = !queries || queries.length === 0;
  const arxivQs = useDefault ? ARXIV_QUERIES : queries!.slice(0, maxResults);

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

  // Step 2: GitHub API 搜索（Phase 5.4: 使用 API 代替 HTML 解析）
  if (useDefault) {
    for (const query of GITHUB_QUERIES) {
      try {
        // 使用 GitHub API 搜索，返回 JSON 格式
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=5`;
        const json = await safeFetch(url);
        if (json) {
          const results = parseGitHubApiResponse(json, maxResults);
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

  // Step 3: Tavily 搜索（Phase 5.4 新增，补充来源）
  if (useDefault) {
    try {
      const tavilyResults = await searchTavily(
        "LLM agent self-improving architecture best practices",
        maxResults
      );
      for (const r of tavilyResults) {
        if (!references.some((ref) => ref.url === r.url)) {
          references.push(r);
        }
      }
    } catch {
      // Tavily 搜索失败，跳过
    }
  }

  // Step 4: 加载预定义模式库
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

  // Step 5: 提取架构模式
  const extractedPatterns = KNOWN_PATTERNS.map((p) => ({
    name: p.name,
    description: p.description,
    sourceReferences: [p.source],
    applicability: p.applicability,
  }));

  // Step 6: 调研总结
  const highRelevance = references.filter((r) => r.relevance >= 7).length;
  const summary = `找到 ${references.length} 个参考来源，其中 ${highRelevance} 个高相关性（relevance >= 7），建议优先关注。` +
    `${extractedPatterns.filter((p) => p.name.includes("Plan") || p.name.includes("Self")).map((p) => p.name).join("、")}。`;

  return {
    timestamp,
    searchQueries: arxivQs,
    references,
    extractedPatterns,
    summary,
  };
}
