/**
 * @file skill.ts — 技能系统与 ClawHub 类型
 * @description
 *   技能系统是 Mini Agent 的模块化扩展机制，包含：
 *   - Skill: 单个可复用的能力单元
 *   - SkillPackage: 一组相关技能的集合
 *   - SkillRegistry: 技能注册表
 *   - ClawHub: 技能市场（搜索/下载）
 *
 * @module types/skill
 */

import type { ToolDefinition, Toolbox, ToolRegistry } from "./tool.js";
import type { AgentConfig } from "./config.js";

// ============================================================================
// 技能元数据
// ============================================================================

/**
 * 技能元数据（gating 信息）
 */
export interface SkillMetadata {
  /** 必需的系统二进制文件 */
  bins?: string[];
  /** 必需的环境变量 */
  env?: string[];
  /** 必需的 AgentConfig 字段 */
  config?: string[];
  /** 主环境变量名 */
  primaryEnv?: string;
  /** 适用操作系统 */
  os?: string[];
  /** 始终加载 */
  always?: boolean;
  /** 技能唯一键 */
  skillKey?: string;
  /** 用户可调用 */
  userInvocable?: boolean;
  /** 排除模型调用 */
  disableModelInvocation?: boolean;
}

/**
 * 技能配置覆盖
 */
export interface SkillEntry {
  /** 是否启用 */
  enabled?: boolean;
  /** 注入的环境变量 */
  env?: Record<string, string>;
  /** API Key */
  apiKey?: string | { source: string; provider: string; id: string };
  /** 自定义配置 */
  config?: Record<string, unknown>;
}

// ============================================================================
// 技能
// ============================================================================

/**
 * 技能：一个独立的、可复用的能力单元
 */
export interface Skill {
  /** 技能唯一标识 */
  id: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 关键词，辅助 LLM 匹配 */
  keywords: string[];
  /** 贡献的工具定义 */
  tools?: Record<string, ToolDefinition>;
  /** 贡献的工具箱 */
  toolboxes?: Toolbox[];
  /** 追加到 system prompt 的指令 */
  systemPrompt?: string;
  /** SKILL.md 原始内容 */
  skillMd?: string;
  /** 技能元数据（gating） */
  metadata?: SkillMetadata;
  /** 来源路径 */
  sourcePath?: string;
}

// ============================================================================
// 技能包
// ============================================================================

/**
 * 技能包：一组相关技能的集合
 */
export interface SkillPackage {
  /** 技能包唯一标识 */
  id: string;
  /** 技能包名称 */
  name: string;
  /** 技能包描述 */
  description: string;
  /** 包含的技能列表 */
  skills: Skill[];
  /** SKILL.md 原始内容 */
  skillMd?: string;
  /** 加载来源路径 */
  sourcePath: string;
}

// ============================================================================
// 技能注册表接口
// ============================================================================

/**
 * 技能注册表接口
 */
export interface SkillRegistry {
  /** 注册一个技能 */
  register(skill: Skill): void;
  /** 注销一个技能 */
  unregister(id: string): boolean;
  /** 查询单个技能 */
  get(id: string): Skill | undefined;
  /** 获取所有技能 */
  getAll(): Skill[];
  /** 获取所有技能包 */
  getPackages(): SkillPackage[];
  /** 注册一个技能包 */
  registerPackage(pkg: SkillPackage): void;
  /** 获取所有技能贡献的工具箱 */
  getAllToolboxes(): Toolbox[];
  /** 获取所有技能贡献的工具 */
  getAllTools(): Record<string, ToolDefinition>;
  /** 获取所有技能的 system prompt 增强 */
  getSystemPrompts(): string[];
  /** 根据配置过滤后的可用技能 */
  getEligibleSkills(config?: AgentConfig): Skill[];
  /** 获取技能配置覆盖 */
  getSkillEntry(id: string): SkillEntry | undefined;
}

// ============================================================================
// ClawHub 技能市场
// ============================================================================

/**
 * ClawHub 技能搜索结果
 */
export interface ClawHubSearchResult {
  /** 技能 slug */
  slug: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 当前版本 */
  version: string;
  /** 标签 */
  tags: string[];
  /** 下载次数 */
  downloads: number;
  /** 星标数 */
  stars: number;
  /** 作者 */
  author: string;
}

/**
 * ClawHub 技能详情
 */
export interface ClawHubSkillDetail {
  /** 技能 slug */
  slug: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 当前版本 */
  version: string;
  /** 标签 */
  tags: string[];
  /** SKILL.md 内容 */
  skillMd: string;
  /** 技能文件列表 */
  files: { path: string; content: string }[];
}

/**
 * ClawHub 客户端接口
 */
export interface ClawHubClient {
  /** 搜索技能 */
  search(query: string, limit?: number): Promise<ClawHubSearchResult[]>;
  /** 获取技能详情 */
  getDetail(slug: string): Promise<ClawHubSkillDetail>;
  /** 下载技能包 */
  download(
    slug: string,
    version?: string,
  ): Promise<{
    path: string;
    files: { path: string; content: string }[];
  }>;
}
