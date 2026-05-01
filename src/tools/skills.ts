/**
 * @file skills.ts — 技能管理工具
 * @description
 *   为 Agent 提供技能搜索、安装、列表能力。
 *   这些工具让 Agent 能够自主管理技能扩展。
 *
 *   包含工具：
 *   - `search_skills`: 搜索 ClawHub 技能市场
 *   - `install_skill`: 下载并安装技能
 *   - `list_skills`: 查看已安装技能
 *
 * @module tools/skills
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClawHubClient, searchLocalSkills } from "../core/clawhub-client.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";

const clawhub = createClawHubClient();

/**
 * 获取技能根目录
 */
function getSkillsRoot(): string {
  if (process.env.MINI_AGENT_SKILLS) return process.env.MINI_AGENT_SKILLS;
  // 从当前工作目录向上查找包含 package.json 的目录
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return path.join(dir, "skills");
    }
    dir = path.dirname(dir);
  }
  return path.join(process.cwd(), "skills");
}

/**
 * 技能管理工具集
 */
export const skillsTools: Record<string, ToolDefinition> = {
  search_skills: {
    schema: {
      type: "function",
      function: {
        name: "search_skills",
        description: "搜索 ClawHub 技能市场或本地已安装的技能。返回技能名称、描述、slug、评分和下载量。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "搜索关键词，如 'web scraper'、'image processing'、'code review'",
            },
            source: {
              type: "string",
              enum: ["clawhub", "local", "all"],
              description: "搜索来源：clawhub=在线市场，local=本地已安装，all=两者都搜索",
            },
            limit: {
              type: "number",
              description: "最大返回结果数（默认 10）",
            },
          },
          required: ["query"],
        },
      },
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      const query = args.query as string;
      const source = (args.source as string) || "all";
      const limit = (args.limit as number) || 10;

      const results: string[] = [];
      results.push(`🔍 搜索技能: "${query}" (来源: ${source})\n`);

      // 本地搜索
      if (source === "local" || source === "all") {
        const skillsRoot = getSkillsRoot();
        const localResults = searchLocalSkills(skillsRoot, query);
        if (localResults.length > 0) {
          results.push("📁 本地技能:");
          for (const s of localResults.slice(0, limit)) {
            results.push(`  - [${s.slug}] ${s.name}: ${s.description}`);
          }
          results.push("");
        } else if (source === "local") {
          results.push("  未找到匹配的本地技能");
        }
      }

      // ClawHub 搜索
      if (source === "clawhub" || source === "all") {
        try {
          const clawhubResults = await clawhub.search(query, limit);
          if (clawhubResults.length > 0) {
            results.push("🌐 ClawHub 技能:");
            for (const s of clawhubResults) {
              results.push(`  - [${s.slug}] ${s.name}: ${s.description} ⭐${s.stars} ⬇${s.downloads}`);
            }
          } else if (source === "clawhub") {
            results.push("  未找到匹配的在线技能");
          }
        } catch (err: any) {
          results.push(`⚠️ ClawHub 搜索失败: ${err?.message ?? err}`);
        }
      }

      return { success: true, content: results.join("\n") || "未找到任何结果" };
    },
    permission: "sandbox",
    help: "搜索技能市场",
    toolbox: "skills_management",
  },

  install_skill: {
    schema: {
      type: "function",
      function: {
        name: "install_skill",
        description: "从 ClawHub 技能市场下载并安装一个技能。安装后需要重启才能生效。",
        parameters: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "技能的 slug（唯一标识符），如 'web-scraper'、'code-reviewer'",
            },
            version: {
              type: "string",
              description: "版本号（可选，默认安装最新版本）",
            },
          },
          required: ["slug"],
        },
      },
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      const slug = args.slug as string;
      const version = args.version as string | undefined;

      try {
        // 先获取技能详情
        const detail = await clawhub.getDetail(slug);
        const skillsRoot = getSkillsRoot();
        const installDir = path.join(skillsRoot, slug);

        // 检查是否已安装
        if (fs.existsSync(installDir)) {
          return {
            success: false,
            content: `⚠️ 技能 "${slug}" 已安装在 ${installDir}\n如需重新安装，请先删除该目录`,
          };
        }

        // 下载并安装
        const result = await clawhub.download(slug, version);
        return {
          success: true,
          content: `✅ 技能 "${slug}" 安装成功！\n\n` +
            `📁 安装路径: ${result.path}\n` +
            `📦 版本: ${detail.version}\n` +
            `📄 文件数: ${result.files.length}\n\n` +
            `💡 提示：重启 Agent 后新技能将自动加载并可用`,
        };
      } catch (err: any) {
        return {
          success: false,
          content: `❌ 安装技能 "${slug}" 失败: ${err?.message ?? err}\n\n` +
            `请检查 slug 是否正确，或网络连接是否正常`,
        };
      }
    },
    permission: "require-confirm",
    help: "安装技能",
    toolbox: "skills_management",
  },

  list_skills: {
    schema: {
      type: "function",
      function: {
        name: "list_skills",
        description: "列出所有已安装的本地技能，包括名称、描述和安装路径。",
        parameters: {
          type: "object",
          properties: {
            verbose: {
              type: "boolean",
              description: "是否显示详细信息（包括元数据）",
            },
          },
        },
      },
    },
    handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
      const verbose = (args.verbose as boolean) || false;
      const skillsRoot = getSkillsRoot();
      const results = searchLocalSkills(skillsRoot, "");

      if (results.length === 0) {
        return {
          success: true,
          content: "📦 暂无已安装的技能\n\n使用 search_skills 工具搜索并安装新技能",
        };
      }

      const lines = ["📦 已安装技能:\n"];
      for (const s of results) {
        lines.push(`  - [${s.slug}] ${s.name}`);
        lines.push(`    ${s.description}`);
        if (verbose) {
          lines.push(`    版本: ${s.version} | 作者: ${s.author}`);
          lines.push(`    路径: ${path.join(skillsRoot, s.slug)}`);
        }
        lines.push("");
      }

      return { success: true, content: lines.join("\n") };
    },
    permission: "sandbox",
    help: "列出已安装技能",
    toolbox: "skills_management",
  },
};
