/**
 * @file skill-loader.ts — 技能包加载器
 * @description
 *   从 skills/ 目录自动发现并加载技能包。
 *
 *   目录结构约定：
 *   ```
 *   skills/
 *   ├── default/                    # 技能包名称（目录名 = 技能包 ID）
 *   │   ├── SKILL.md                # 技能包总览文档（可选）
 *   │   └── skills/                 # 子技能目录（可选）
 *   │       └── file-tools/
 *   │           ├── SKILL.md        # 单个技能文档
 *   │           └── tools.ts        # 工具定义入口
 *   └── custom/
 *       └── ...
 *   ```
 *
 *   加载规则：
 *   1. 扫描 skills/ 下所有一级子目录（每个 = 一个 SkillPackage）
 *   2. 读取 SKILL.md 作为技能包文档
 *   3. 尝试导入 index.ts 获取 Skill[] 导出
 *   4. 如果 index.ts 不存在，尝试动态加载 skills/ 子目录
 *
 *   技能包注册优先级：
 *   - 显式注册的包优先于自动发现的包
 *   - 同名包后加载的覆盖先加载的
 *
 * @module core/skill-loader
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { Skill, SkillPackage } from "./types.js";

/**
 * 解析 SKILL.md 文件头部的 YAML front matter
 *
 * 格式：
 * ```markdown
 * ---
 * name: 文件操作
 * description: 提供完整的文件管理能力
 * ---
 * 正文内容...
 * ```
 *
 * @param content - SKILL.md 完整内容
 * @returns { meta: 解析后的元数据, body: 正文内容 }
 */
export function parseSkillMd(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};

  // 尝试匹配 YAML front matter（--- 包裹的键值对）
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (frontMatterMatch) {
    const frontMatter = frontMatterMatch[1];
    const body = frontMatterMatch[2];

    // 解析每一行 key: value
    for (const line of frontMatter.split("\n")) {
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) {
        meta[kv[1]] = kv[2].trim();
      }
    }
    return { meta, body };
  }

  // 没有 front matter，整个文件作为 body
  return { meta, body: content };
}

/**
 * 尝试从目录动态加载一个技能包
 *
 * 加载流程：
 * 1. 读取 SKILL.md（如果存在）
 * 2. 尝试 require/import index.ts 获取 Skill[]
 * 3. 如果 index.ts 不存在，创建空技能包
 *
 * @param packageDir - 技能包目录路径
 * @returns SkillPackage 或 null（加载失败）
 */
export async function loadSkillPackage(packageDir: string): Promise<SkillPackage | null> {
  const packageName = path.basename(packageDir);
  const skillMdPath = path.join(packageDir, "SKILL.md");

  // ── 读取 SKILL.md ──
  let skillMd: string | undefined;
  let name = packageName;
  let description = `技能包: ${packageName}`;

  if (fs.existsSync(skillMdPath)) {
    skillMd = fs.readFileSync(skillMdPath, "utf-8");
    const { meta, body } = parseSkillMd(skillMd);
    if (meta.name) name = meta.name;
    if (meta.description) description = meta.description;
    // 如果没有 front matter，从正文第一行提取标题
    if (!meta.name) {
      const titleMatch = body.match(/^#\s+(.+)$/m);
      if (titleMatch) name = titleMatch[1].trim();
    }
  }

  // ── 尝试加载 index.ts 中的技能定义 ──
  let skills: Skill[] = [];
  const indexPath = path.join(packageDir, "index.ts");
  const indexJsPath = path.join(packageDir, "index.js");

  if (fs.existsSync(indexPath) || fs.existsSync(indexJsPath)) {
    try {
      // ESM 动态导入：Windows 路径必须转为 file:// URL
      const importPath = pathToFileURL(fs.existsSync(indexPath) ? indexPath : indexJsPath).href;
      const mod = await import(importPath);
      if (Array.isArray(mod.skills)) {
        skills = mod.skills;
      } else if (Array.isArray(mod.default)) {
        skills = mod.default;
      }
    } catch (err) {
      console.warn(`⚠️ 加载 ${indexPath} 失败: ${err}`);
    }
  }

  // ── 尝试从 skills/ 子目录加载子技能 ──
  const skillsDir = path.join(packageDir, "skills");
  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    const subSkills = await loadSubSkills(skillsDir);
    skills = [...skills, ...subSkills];
  }

  // 如果没有任何技能，但有 SKILL.md，仍然返回（可能是纯文档型技能包）
  if (skills.length === 0 && !skillMd) {
    return null;
  }

  return {
    id: packageName,
    name,
    description,
    skills,
    skillMd,
    sourcePath: packageDir,
  };
}

/**
 * 从 skills/ 子目录加载子技能
 *
 * 每个子目录 = 一个 Skill，包含：
 * - SKILL.md（必需或可选）
 * - tools.ts（可选，导出工具定义）
 */
async function loadSubSkills(skillsDir: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    const toolsPath = path.join(skillDir, "tools.ts");
    const toolsJsPath = path.join(skillDir, "tools.js");

    // ── 读取 SKILL.md ──
    let skillMd: string | undefined;
    let name = entry.name;
    let description = "";
    let keywords: string[] = [];

    if (fs.existsSync(skillMdPath)) {
      skillMd = fs.readFileSync(skillMdPath, "utf-8");
      const { meta, body } = parseSkillMd(skillMd);
      name = meta.name || name;
      description = meta.description || body.slice(0, 200).trim();
      keywords = meta.keywords ? meta.keywords.split(",").map((k: string) => k.trim()) : [];
    }

    // ── 尝试加载工具定义 ──
    let tools: Record<string, any> | undefined;
    if (fs.existsSync(toolsPath) || fs.existsSync(toolsJsPath)) {
      try {
        const targetPath = fs.existsSync(toolsPath) ? toolsPath : toolsJsPath;
        const importPath = pathToFileURL(targetPath).href;
        const mod = await import(importPath);
        // 导出格式：{ toolName: ToolDefinition, ... }
        tools = {};
        for (const [key, value] of Object.entries(mod)) {
          if (key !== "default" && value && typeof value === "object" && "schema" in value && "handler" in value) {
            tools[key] = value;
          }
        }
      } catch {
        console.warn(`⚠️ 加载 ${toolsPath} 失败`);
      }
    }

    // 只有当有 SKILL.md 或工具定义时才注册
    if (skillMd || tools) {
      skills.push({
        id: `${path.basename(skillsDir)}-${entry.name}`,
        name,
        description,
        keywords,
        tools,
        skillMd,
      });
    }
  }

  return skills;
}

/**
 * 发现并加载 skills/ 目录下的所有技能包
 *
 * @param skillsRoot - skills 目录根路径
 * @returns 加载成功的 SkillPackage 列表
 */
export async function discoverSkillPackages(skillsRoot: string): Promise<SkillPackage[]> {
  if (!fs.existsSync(skillsRoot)) return [];

  const packages: SkillPackage[] = [];

  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pkgDir = path.join(skillsRoot, entry.name);
    const pkg = await loadSkillPackage(pkgDir);
    if (pkg) {
      packages.push(pkg);
    }
  }

  return packages;
}
