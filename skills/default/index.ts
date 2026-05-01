/**
 * default 技能包 — 空壳示例
 *
 * 此技能包仅包含文档（SKILL.md），用于演示技能包结构。
 * 实际的内置工具已在 cli.ts 中直接注册，无需通过技能包贡献。
 *
 * 要创建真正的贡献工具的技能包，请参考 skills/README.md。
 */

import type { Skill } from "../../core/types.js";

// 空技能列表：内置工具已由 cli.ts 直接注册
export const skills: Skill[] = [];
