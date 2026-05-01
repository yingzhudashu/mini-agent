/**
 * @file skill-registry.ts — 技能注册表
 * @description
 *   管理所有技能的生命周期：注册、注销、查询、合并、gating。
 *
 *   DefaultSkillRegistry 实现了 SkillRegistry 接口，提供：
 *   1. 技能的注册与注销
 *   2. 按 ID 查询单个技能
 *   3. 获取所有已注册技能
 *   4. 聚合所有技能贡献的工具箱（用于 Phase 1 规划）
 *   5. 聚合所有技能贡献的工具定义（用于注册到 ToolRegistry）
 *   6. 收集所有技能的系统提示词增强（用于追加到 system prompt）
 *   7. 根据 gating 条件过滤可用技能（v4.1 新增）
 *
 *   Gating 机制（参考 OpenClaw 的 metadata.openclaw）：
 *   - requires.bins: 系统必须存在的二进制文件
 *   - requires.env: 必须存在的环境变量
 *   - requires.config: 必须为真的 AgentConfig 键
 *   - os: 适用的操作系统
 *   - always: 始终可用（跳过所有 gate）
 *
 *   设计原则：
 *   - 使用 Map 存储，保证 O(1) 查询
 *   - 后注册的同名技能覆盖先注册的
 *   - 工具/工具箱聚合时自动去重（按 ID）
 *   - 技能配置覆盖（skills.entries）优先级高于默认配置
 *
 * @module core/skill-registry
 */

import * as fs from "node:fs";
import type {
  Skill,
  SkillPackage,
  SkillRegistry,
  SkillEntry,
  Toolbox,
  ToolDefinition,
  AgentConfig,
} from "./types.js";

/**
 * 默认技能注册表实现
 *
 * 内部使用 Map 按技能 ID 存储 Skill 对象。
 * 支持单个技能注册和技能包批量注册。
 *
 * @example
 *   const registry = new DefaultSkillRegistry();
 *
 *   // 注册单个技能
 *   registry.register({
 *     id: "my-skill",
 *     name: "我的技能",
 *     description: "描述",
 *     keywords: ["关键词"],
 *   });
 *
 *   // 注册技能包
 *   registry.registerPackage(skillPackage);
 *
 *   // 获取聚合的工具箱
 *   const toolboxes = registry.getAllToolboxes();
 */
export class DefaultSkillRegistry implements SkillRegistry {
  /** 内部存储：技能 ID → Skill 对象 */
  private skills = new Map<string, Skill>();

  /** 已注册的技能包列表 */
  private packages: SkillPackage[] = [];

  /** 技能配置覆盖（参考 OpenClaw 的 skills.entries） */
  private skillEntries: Record<string, SkillEntry> = {};

  /**
   * 注册一个技能
   *
   * 如果同名技能已存在，后注册的覆盖先注册的。
   *
   * @param skill - 要注册的技能对象
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * 注销一个技能
   *
   * @param id - 技能 ID
   * @returns true 如果成功移除，false 如果技能不存在
   */
  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  /**
   * 获取指定技能
   *
   * @param id - 技能 ID
   * @returns Skill 对象，或 undefined
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * 获取所有已注册技能
   *
   * @returns Skill 数组（按注册顺序）
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取所有已注册的技能包
   *
   * @returns SkillPackage 数组
   */
  getPackages(): SkillPackage[] {
    return [...this.packages];
  }

  /**
   * 注册一个技能包（批量注册其中所有技能）
   *
   * 将 pkg.skills 中的每个技能逐一注册到注册表中。
   * 如果技能包本身有 SKILL.md，将其附加到每个技能的 skillMd 字段上。
   *
   * @param pkg - 要注册的技能包
   */
  registerPackage(pkg: SkillPackage): void {
    this.packages.push(pkg);
    for (const skill of pkg.skills) {
      // 如果技能自己没有 skillMd 但技能包有，附加上
      if (!skill.skillMd && pkg.skillMd) {
        skill.skillMd = pkg.skillMd;
      }
      this.register(skill);
    }
  }

  /**
   * 获取所有技能贡献的工具箱
   *
   * 自动去重：如果多个技能贡献了相同 ID 的工具箱，只保留第一个。
   *
   * @returns Toolbox[] 去重后的工具箱列表
   */
  getAllToolboxes(): Toolbox[] {
    const seen = new Set<string>();
    const result: Toolbox[] = [];
    for (const skill of this.skills.values()) {
      if (!skill.toolboxes) continue;
      for (const tb of skill.toolboxes) {
        if (!seen.has(tb.id)) {
          seen.add(tb.id);
          result.push(tb);
        }
      }
    }
    return result;
  }

  /**
   * 获取所有技能贡献的工具定义
   *
   * 自动去重：如果多个技能贡献了相同名称的工具，后注册的覆盖先注册的。
   *
   * @returns Record<string, ToolDefinition> 工具名称到定义的映射
   */
  getAllTools(): Record<string, ToolDefinition> {
    const result: Record<string, ToolDefinition> = {};
    for (const skill of this.skills.values()) {
      if (!skill.tools) continue;
      Object.assign(result, skill.tools);
    }
    return result;
  }

  /**
   * 获取所有技能的系统提示词增强
   *
   * 按注册顺序收集所有 skill.systemPrompt，过滤掉空值。
   *
   * @returns string[] 系统提示词片段数组
   */
  getSystemPrompts(): string[] {
    const prompts: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.systemPrompt && skill.systemPrompt.trim()) {
        prompts.push(skill.systemPrompt);
      }
    }
    return prompts;
  }

  /**
   * 设置技能配置覆盖（参考 OpenClaw 的 skills.entries）
   *
   * @param entries - 技能配置覆盖映射
   */
  setSkillEntries(entries: Record<string, SkillEntry>): void {
    this.skillEntries = entries;
  }

  /**
   * 获取指定技能的配置覆盖
   *
   * @param id - 技能 ID
   * @returns SkillEntry 或 undefined
   */
  getSkillEntry(id: string): SkillEntry | undefined {
    return this.skillEntries[id];
  }

  /**
   * 根据 gating 条件过滤可用的技能
   *
   * 检查条件（按优先级）：
   * 1. enabled=false → 禁用
   * 2. metadata.always=true → 始终可用
   * 3. metadata.os → 操作系统匹配
   * 4. metadata.requires.bins → 二进制文件检查
   * 5. metadata.requires.env → 环境变量检查
   * 6. metadata.requires.config → AgentConfig 键检查
   *
   * @param config - Agent 配置（用于 config gating 检查）
   * @returns 符合 gating 条件的技能列表
   */
  getEligibleSkills(config?: AgentConfig): Skill[] {
    const eligible: Skill[] = [];

    for (const skill of this.skills.values()) {
      const entry = this.skillEntries[skill.id];

      // 检查 enabled
      if (entry?.enabled === false) continue;

      const meta = skill.metadata;
      if (!meta) {
        eligible.push(skill);
        continue;
      }

      // always=true 跳过所有 gate
      if (meta.always) {
        eligible.push(skill);
        continue;
      }

      // 操作系统检查
      if (meta.os && meta.os.length > 0) {
        const currentOs = process.platform;
        if (!meta.os.includes(currentOs)) continue;
      }

      // 二进制文件检查
      if (meta.bins && meta.bins.length > 0) {
        const hasAllBins = meta.bins.every((bin) => isBinAvailable(bin));
        if (!hasAllBins) continue;
      }

      // 环境变量检查
      if (meta.env && meta.env.length > 0) {
        const hasAllEnv = meta.env.every((key) => process.env[key] || (entry?.env && key in entry.env));
        if (!hasAllEnv) continue;
      }

      // config 键检查
      if (meta.config && meta.config.length > 0 && config) {
        const hasAllConfig = meta.config.every((key) => {
          // 简单检查：config 对象中是否存在该键且为真值
          return key in config && !!(config as any)[key];
        });
        if (!hasAllConfig) continue;
      }

      eligible.push(skill);
    }

    return eligible;
  }
}

/**
 * 检查二进制文件是否在 PATH 上可用
 *
 * 使用 which 命令（Windows 使用 where）。
 *
 * @param bin - 二进制文件名
 * @returns 是否可用
 */
function isBinAvailable(bin: string): boolean {
  try {
    const isWin = process.platform === "win32";
    const cmd = isWin ? `where ${bin}` : `which ${bin}`;
    const { execSync } = require("child_process");
    execSync(cmd, { stdio: "pipe", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
