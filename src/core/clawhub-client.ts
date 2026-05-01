/**
 * @file clawhub-client.ts — ClawHub 技能市场客户端
 * @description
 *   参考 OpenClaw 的 ClawHub (clawhub.ai) 设计，为 Mini Agent 提供：
 *   - 技能搜索（关键词/标签）
 *   - 技能详情查看
 *   - 技能下载和安装
 *
 *   ClawHub API 约定：
 *   - 基础 URL: https://clawhub.ai/api
 *   - 搜索: GET /v1/skills/search?q=<query>&limit=<n>
 *   - 详情: GET /v1/skills/<slug>
 *   - 下载: GET /v1/skills/<slug>/download?version=<ver>
 *
 *   注意：由于 ClawHub 是 OpenClaw 专用平台，此处使用兼容的 API 接口。
 *   如果 API 不可用，会降级为本地技能搜索。
 *
 * @module core/clawhub-client
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ClawHubClient, ClawHubSearchResult, ClawHubSkillDetail } from "./types.js";

/** ClawHub API 基础 URL */
const CLAWHUB_API = "https://clawhub.ai/api/v1";

/**
 * 创建 ClawHub 客户端
 *
 * @param baseUrl - API 基础 URL（可选，默认使用 ClawHub 官方 API）
 */
export function createClawHubClient(baseUrl: string = CLAWHUB_API): ClawHubClient {
  /**
   * 发起 HTTP GET 请求
   */
  async function fetchJson<T>(url: string): Promise<T> {
    const resp = await fetch(url, {
      headers: { "User-Agent": "mini-agent-clawhub/1.0" },
    });
    if (!resp.ok) {
      throw new Error(`ClawHub API 错误: ${resp.status} ${resp.statusText}`);
    }
    return resp.json() as Promise<T>;
  }

  return {
    /**
     * 搜索技能
     *
     * @param query - 搜索关键词
     * @param limit - 最大结果数（默认 20）
     */
    async search(query: string, limit = 20): Promise<ClawHubSearchResult[]> {
      const url = `${baseUrl}/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      return fetchJson<ClawHubSearchResult[]>(url);
    },

    /**
     * 获取技能详情
     *
     * @param slug - 技能 slug
     */
    async getDetail(slug: string): Promise<ClawHubSkillDetail> {
      const url = `${baseUrl}/skills/${slug}`;
      return fetchJson<ClawHubSkillDetail>(url);
    },

    /**
     * 下载技能包
     *
     * 流程：
     * 1. 从 API 获取技能文件列表和内容
     * 2. 写入本地 skills/<slug>/ 目录
     * 3. 返回本地路径
     *
     * @param slug - 技能 slug
     * @param version - 版本号（可选，默认 latest）
     */
    async download(slug: string, version?: string): Promise<{
      path: string;
      files: { path: string; content: string }[];
    }> {
      // 先获取详情
      const detail = await this.getDetail(slug);
      const files = detail.files;

      // 确定本地路径
      const projectRoot = findProjectRoot();
      const skillsDir = path.join(projectRoot, "skills", slug);

      // 写入文件
      for (const file of files) {
        const filePath = path.join(skillsDir, file.path);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, "utf-8");
      }

      // 写入 .clawhub 元数据
      const metaPath = path.join(skillsDir, ".clawhub.json");
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            slug: detail.slug,
            version: detail.version,
            installedAt: new Date().toISOString(),
            source: "clawhub",
          },
          null,
          2,
        ),
        "utf-8",
      );

      return { path: skillsDir, files };
    },
  };
}

/**
 * 查找项目根目录（包含 package.json 的目录）
 */
function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * 本地技能搜索（不依赖网络）
 *
 * 当 ClawHub API 不可用时，回退到本地技能目录搜索。
 *
 * @param skillsRoot - 技能目录路径
 * @param query - 搜索关键词
 */
export function searchLocalSkills(
  skillsRoot: string,
  query: string,
): ClawHubSearchResult[] {
  if (!fs.existsSync(skillsRoot)) return [];

  const results: ClawHubSearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const skillDir = path.join(skillsRoot, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, "utf-8");

    // 简单的关键词匹配（名称、描述、关键词）
    const metaMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const frontmatter = metaMatch ? metaMatch[1] : "";

    const name = (frontmatter.match(/name:\s*(.+)/)?.[1] || entry.name).trim();
    const description = (frontmatter.match(/description:\s*(.+)/)?.[1] || "").trim();

    if (
      name.toLowerCase().includes(queryLower) ||
      description.toLowerCase().includes(queryLower) ||
      content.toLowerCase().includes(queryLower)
    ) {
      results.push({
        slug: entry.name,
        name,
        description,
        version: "local",
        tags: [],
        downloads: 0,
        stars: 0,
        author: "local",
      });
    }
  }

  return results;
}
