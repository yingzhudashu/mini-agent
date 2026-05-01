/**
 * @file index.ts — Self-Optimization 技能包入口
 * @description
 *   导出自我优化技能的元数据。
 *   工具定义在 src/tools/self-opt.ts 中注册。
 */

import type { Skill } from "../../src/core/types.js";

export const skills: Skill[] = [
  {
    id: "self-optimization",
    name: "自我优化",
    description: "Agent 自我审视、外部调研、生成优化提案、实施变更并验证",
    keywords: ["自我优化", "架构分析", "代码质量", "优化提案", "测试验证", "self-improvement"],
    systemPrompt:
      "你具备自我优化能力。当用户要求优化自身架构时，使用 self_inspect 分析当前代码质量，" +
      "使用 external_research 搜索最新架构模式，然后生成优化提案并实施。" +
      "低风险改动自动执行，高风险改动必须确认。",
  },
];
