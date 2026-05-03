/**
 * @file skill.ts — 技能系统类型
 * @description
 *   技能系统是 Mini Agent 的模块化扩展机制。
 *
 *   架构层次：
 *   - Skill: 单个可复用的能力单元
 *   - SkillPackage: 一组相关技能的集合
 *   - SkillRegistry: 技能注册表接口
 *   - SkillMetadata: 技能元数据（gating 信息）
 *   - SkillEntry: 技能配置覆盖
 *
 * @module types/skill
 */

import type { ToolDefinition, Toolbox, ToolRegistry } from "./tool.js";
import type { AgentConfig } from "./config.js";

// ============================================================================
// 技能元数据
// ============================================================================

/**
 * 技能元数据（gating 信息，参考 OpenClaw 的 metadata.openclaw）
 *
 * 用于判断技能是否可以在当前环境下加载。
 */
export interface SkillMetadata {
  /** 必需的系统二进制文件 */
  bins?: string[];
  /** 必需的环境变量 */
  env?: string[];
  /** 必需的 AgentConfig 字段 */
  config?: string[];
  /** 主环境变量名（用于 apiKey 注入） */
  primaryEnv?: string;
  /** 适用操作系统 */
  os?: string[];
  /** 始终加载（跳过 gating） */
  always?: boolean;
  /** 技能唯一键（用于 skills.entries 配置） */
  skillKey?: string;
  /** 用户可调用（作为 slash 命令） */
  userInvocable?: boolean;
  /** 排除模型调用 */
  disableModelInvocation?: boolean;
}

/**
 * 技能配置覆盖（参考 OpenClaw 的 skills.entries）
 */
export interface SkillEntry {
  /** 是否启用 */
  enabled?: boolean;
  /** 注入的环境变量 */
  env?: Record<string, string>;
  /** API Key（支持明文或 SecretRef） */
  apiKey?: string | { source: string; provider: string; id: string };
  /** 自定义配置 */
  config?: Record<string, unknown>;
}

// ============================================================================
// 技能
// ============================================================================

/**
 * 技能：一个独立的、可复用的能力单元
 *
 * 每个技能可以贡献：
 * 1. 工具定义（tools）→ 注册到 ToolRegistry
 * 2. 工具箱（toolboxes）→ 用于 Phase 1 规划筛选
 * 3. 系统提示词增强（systemPrompt）→ 追加到 system prompt
 * 4. SKILL.md → 人类可读的技能说明文档
 * 5. 元数据（metadata）→ gating 和安装信息
 *
 * 与 Toolbox 的区别：
 * - Toolbox 是纯描述性的（id + name + description + keywords）
 * - Skill 是功能性的：包含实际的工具实现 + 文档 + 系统提示
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
 *
 * 目录结构：
 * ```
 * skills/<package-name>/
 *   ├── SKILL.md          # 技能包总览文档
 *   ├── index.ts          # 技能包入口（导出 Skill[]）
 *   └── <skill-id>/
 *       ├── SKILL.md      # 单个技能文档
 *       └── tools.ts      # 工具定义
 * ```
 */
export interface SkillPackage {
  /** 技能包唯一标识（通常等于目录名） */
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
 *
 * 管理技能包的生命周期：注册、注销、查询、过滤。
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
  /** 根据配置过滤后的可用技能（考虑 gating） */
  getEligibleSkills(config?: AgentConfig): Skill[];
  /** 获取技能配置覆盖 */
  getSkillEntry(id: string): SkillEntry | undefined;
}
