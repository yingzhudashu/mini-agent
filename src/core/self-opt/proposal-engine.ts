/**
 * @file proposal-engine.ts — Proposal Engine 优化提案引擎
 * @description
 *   基于自我审视报告和外部调研报告，生成结构化优化提案。
 *
 *   工作流程：
 *   1. 分析审视报告的痛点和建议
 *   2. 结合调研报告的架构模式
 *   3. 生成带测试用例的优化提案
 *   4. 按风险等级排序
 *
 *   设计原则：
 *   - 提案必须包含测试用例
 *   - 低风险提案可自动执行
 *   - 高风险提案需用户确认
 *
 * @module core/self-opt/proposal-engine
 */

import type {
  InspectionReport,
  ResearchReport,
  OptimizationProposal,
  TestCase,
  FileChange,
} from "./types.js";

// ============================================================================
// 提案模板
// ============================================================================

/** 提案生成模板 */
interface ProposalTemplate {
  /** 匹配条件：痛点关键词 */
  matchPainPoints: string[];
  /** 提案类型 */
  type: "add" | "remove" | "modify" | "refactor";
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "destructive";
  /** 标题 */
  title: string;
  /** 描述模板 */
  description: (report: InspectionReport) => string;
  /** 依据模板 */
  rationale: (research: ResearchReport) => string;
  /** 预期收益 */
  benefit: string;
  /** 生成的测试用例 */
  generateTestCases: (report: InspectionReport) => TestCase[];
  /** 依赖 */
  dependencies: string[];
}

/** 预定义提案模板 */
const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    matchPainPoints: ["没有对应测试", "测试覆盖", "hasTests: false"],
    type: "add",
    riskLevel: "low",
    title: "添加缺失的测试文件",
    description: (r) => `为 ${r.moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50).map((m) => m.path).join(", ")} 添加单元测试`,
    rationale: () => "测试驱动开发是软件工程最佳实践，提高代码可靠性",
    benefit: "提升测试覆盖率，减少回归 bug",
    generateTestCases: (r) => {
      const untested = r.moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
      return untested.map((m, i) => ({
        id: `tc-test-${i}`,
        type: "unit" as const,
        description: `验证 ${m.path} 的核心功能`,
        setup: "导入目标模块",
        action: "调用导出的函数",
        expected: "函数正常执行并返回预期类型",
        command: `npm run build`,
      }));
    },
    dependencies: [],
  },
  {
    matchPainPoints: ["复杂度过高", "complexity"],
    type: "refactor",
    riskLevel: "medium",
    title: "简化高复杂度模块",
    description: (r) => {
      const complex = r.moduleAnalysis.filter((m) => m.complexityScore >= 7);
      return `重构 ${complex.map((m) => `${m.path} (评分: ${m.complexityScore})`).join(", ")}`;
    },
    rationale: () => "高复杂度代码难以维护，增加 bug 风险",
    benefit: "降低维护成本，提高代码可读性",
    generateTestCases: (r) => {
      const complex = r.moduleAnalysis.filter((m) => m.complexityScore >= 7);
      return complex.map((m, i) => ({
        id: `tc-refactor-${i}`,
        type: "unit" as const,
        description: `重构后 ${m.path} 功能不变`,
        setup: "准备输入数据",
        action: "执行重构后的模块",
        expected: "输出与重构前一致",
        command: `npm run build`,
      }));
    },
    dependencies: [],
  },
  {
    matchPainPoints: ["any 类型", "类型安全"],
    type: "modify",
    riskLevel: "low",
    title: "消除 any 类型",
    description: (r) => "将代码中的 any 类型替换为精确的 TypeScript 类型",
    rationale: () => "any 类型绕过类型检查，降低代码安全性",
    benefit: "提高类型安全，减少运行时错误",
    generateTestCases: () => [
      {
        id: "tc-types-0",
        type: "unit" as const,
        description: "TypeScript 编译通过",
        setup: "",
        action: "运行 tsc",
        expected: "无编译错误",
        command: "npm run build",
      },
    ],
    dependencies: [],
  },
  {
    matchPainPoints: ["架构完整", "未通过", "missing"],
    type: "add",
    riskLevel: "medium",
    title: "完善缺失的架构组件",
    description: (r) => {
      const failed = r.architectureChecks.filter((c) => !c.passed);
      return `实现缺失的架构组件: ${failed.map((c) => c.name).join(", ")}`;
    },
    rationale: (research) => {
      const patterns = research.extractedPatterns.slice(0, 2);
      return `参考架构模式: ${patterns.map((p) => p.name).join(", ")}`;
    },
    benefit: "提升架构完整性，增强系统健壮性",
    generateTestCases: (r) => {
      const failed = r.architectureChecks.filter((c) => !c.passed);
      return failed.map((c, i) => ({
        id: `tc-arch-${i}`,
        type: "integration" as const,
        description: `验证 ${c.name} 功能正常`,
        setup: "初始化相关模块",
        action: "调用组件 API",
        expected: c.details,
        command: "npm run build",
      }));
    },
    dependencies: [],
  },
  {
    matchPainPoints: ["空 catch", "吞异常"],
    type: "modify",
    riskLevel: "low",
    title: "修复空 catch 块",
    description: () => "为空的 catch 块添加日志记录或错误处理逻辑",
    rationale: () => "空 catch 块会吞掉错误，导致难以调试的问题",
    benefit: "提高错误可见性，便于问题排查",
    generateTestCases: () => [
      {
        id: "tc-catch-0",
        type: "unit" as const,
        description: "TypeScript 编译通过",
        setup: "",
        action: "运行 tsc",
        expected: "无编译错误",
        command: "npm run build",
      },
    ],
    dependencies: [],
  },
];

// ============================================================================
// 文件变更生成（Phase 4）
// ============================================================================

/**
 * 根据模板和审视报告生成文件变更计划
 * Phase 4: 为提案预生成文件变更，便于 executeOptimization 直接应用
 */
function generateFileChanges(
  template: ProposalTemplate,
  inspection: InspectionReport,
): FileChange[] {
  const changes: FileChange[] = [];

  // 根据模板类型生成不同的变更计划
  if (template.matchPainPoints.some((p) => p.includes("测试") || p.includes("hasTests"))) {
    // 为没有测试的模块生成测试文件变更计划
    const untested = inspection.moduleAnalysis.filter(
      (m) => !m.hasTests && m.linesOfCode > 50,
    );
    for (const m of untested.slice(0, 3)) {
      const testPath = `tests/${m.path.replace(/\.ts$/, ".test.ts").replace(/src\//, "")}`;
      changes.push({
        path: testPath,
        action: "create",
        content: generateTestFileSkeleton(m),
        description: `为 ${m.path} 添加单元测试骨架`,
      });
    }
  }

  if (template.matchPainPoints.some((p) => p.includes("any 类型") || p.includes("类型安全"))) {
    // 标记需要修复 any 类型的文件
    const filesWithAny = inspection.moduleAnalysis
      .filter((m) => m.issues.some((i) => i.includes("any")))
      .slice(0, 3);
    for (const m of filesWithAny) {
      changes.push({
        path: m.path,
        action: "modify",
        description: `替换 ${m.path} 中的 any 类型为精确类型`,
      });
    }
  }

  if (template.matchPainPoints.some((p) => p.includes("空 catch"))) {
    const filesWithEmptyCatch = inspection.moduleAnalysis
      .filter((m) => m.issues.some((i) => i.includes("catch") || i.includes("空")))
      .slice(0, 3);
    for (const m of filesWithEmptyCatch) {
      changes.push({
        path: m.path,
        action: "modify",
        description: `为 ${m.path} 的空 catch 块添加错误处理`,
      });
    }
  }

  return changes;
}

/** 生成测试文件骨架 */
function generateTestFileSkeleton(module: { path: string; exportsCount: number }): string {
  const moduleName = module.path.replace(/.*[/\\]/, "").replace(".ts", "");
  return `import { describe, it } from 'node:test';
import assert from 'node:assert';

// TODO: 导入 ${moduleName} 模块
// import { } from '../src/${moduleName}';

describe('${moduleName}', () => {
  it('should exist', () => {
    // TODO: 实现测试逻辑
    assert.ok(true);
  });
});
`;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 生成优化提案列表
 *
 * @param inspection 自我审视报告
 * @param research 外部调研报告
 * @returns 按风险等级排序的提案列表（低风险在前）
 */
export function generateProposals(
  inspection: InspectionReport,
  research: ResearchReport
): OptimizationProposal[] {
  const proposals: OptimizationProposal[] = [];
  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2, destructive: 3 };

  for (const template of PROPOSAL_TEMPLATES) {
    // 检查是否有匹配的痛点
    const hasMatch = template.matchPainPoints.some((keyword) => {
      const lowerKeyword = keyword.toLowerCase();
      return inspection.painPoints.some((p) => p.description.toLowerCase().includes(lowerKeyword)) ||
        inspection.architectureChecks.some((c) => !c.passed && c.name.toLowerCase().includes(lowerKeyword));
    });

    if (!hasMatch) continue;

    const testCases = template.generateTestCases(inspection);

    proposals.push({
      id: `prop-${Date.now()}-${proposals.length}`,
      type: template.type,
      riskLevel: template.riskLevel,
      target: template.title,
      description: template.description(inspection),
      rationale: template.rationale(research),
      expectedBenefit: template.benefit,
      files: generateFileChanges(template, inspection), // Phase 4: 生成实际文件变更计划
      dependencies: template.dependencies,
      testCases,
      rollbackPlan: "Git reset 到变更前的快照",
    });
  }

  // 按风险等级排序（低风险在前，便于自动执行）
  proposals.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

  return proposals;
}

/**
 * 格式化提案列表为可读文本
 */
export function formatProposals(proposals: OptimizationProposal[]): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════",
    "📋 Optimization Proposals",
    "═══════════════════════════════════════════════════",
    `共 ${proposals.length} 个提案`,
    "",
  ];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const riskIcon = p.riskLevel === "low" ? "🟢" : p.riskLevel === "medium" ? "🟡" : "🔴";
    lines.push(`${riskIcon} [${i + 1}] ${p.target}`);
    lines.push(`    类型: ${p.type} | 风险: ${p.riskLevel}`);
    lines.push(`    ${p.description}`);
    lines.push(`    依据: ${p.rationale}`);
    lines.push(`    收益: ${p.expectedBenefit}`);
    if (p.testCases.length > 0) {
      lines.push(`    测试: ${p.testCases.length} 个用例`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
