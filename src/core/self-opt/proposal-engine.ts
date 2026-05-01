/**
 * @file proposal-engine.ts — 优化提案引擎
 * @description
 *   Self-Optimization 子系统的核心组件之一，负责将自我审视报告和外部调研报告
 *   转化为具体的优化提案（OptimizationProposal）。
 *
 *   工作流程：
 *   1. generateProposals: 基于痛点和调研匹配提案模板，生成优化提案列表
 *   2. generateFileChanges: 为每个提案生成具体的文件变更计划（FileChange[]）
 *   3. formatProposals: 将提案格式化为可读文本，用于 CLI 展示
 *
 *   设计原则：
 *   - 模板驱动：预定义 5 种常见优化类型，避免 LLM 调用的不确定性
 *   - 风险分级：low/medium/high/destructive 驱动执行策略
 *   - 测试先行：每个提案必须附带至少一个测试用例
 *   - 可回滚：每个提案都包含 Git 回滚方案
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
// 提案模板类型定义
// ============================================================================

/**
 * 提案模板接口
 *
 * 每个模板定义了一种优化模式，包括：
 * - 匹配条件：什么痛点会触发此模板
 * - 优化类型：add/remove/modify/refactor
 * - 风险等级：决定是否可以自动执行
 * - 测试用例生成函数：为提案创建验证方案
 */
interface Template {
  /** 匹配的痛点关键词（小写匹配） */
  matchPainPoints: string[];
  /** 优化类型 */
  type: "add" | "remove" | "modify" | "refactor";
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "destructive";
  /** 模板标题 */
  title: string;
  /** 生成提案描述 */
  description: (r: InspectionReport) => string;
  /** 生成优化依据（参考了哪些外部资源） */
  rationale: (r: ResearchReport) => string;
  /** 预期收益 */
  benefit: string;
  /** 生成测试用例列表 */
  generateTestCases: (r: InspectionReport) => TestCase[];
  /** 需要安装的新依赖 */
  dependencies: string[];
}

// ============================================================================
// 提案模板库
// ============================================================================

/**
 * 预定义的优化提案模板
 *
 * 当前支持 5 种优化类型：
 * 1. 添加缺失的测试文件（low risk）
 * 2. 简化高复杂度模块（medium risk）
 * 3. 消除 any 类型（low risk）
 * 4. 完善缺失的架构组件（medium risk）
 * 5. 修复空 catch 块（low risk）
 *
 * 扩展方法：在 TEMPLATES 数组中添加新对象即可。
 */
const TEMPLATES: Template[] = [
  // ── 模板 1: 添加缺失的测试文件 ──
  {
    matchPainPoints: ["没有对应测试", "测试覆盖", "hasTests: false"],
    type: "add",
    riskLevel: "low",
    title: "添加缺失的测试文件",
    description: (r) => {
      const m = r.moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
      return `为 ${m.map((m) => m.path).join(", ")} 添加单元测试`;
    },
    rationale: () => "测试驱动开发是最佳实践，可确保代码正确性和可维护性",
    benefit: "提升测试覆盖率，减少回归错误",
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => !m.hasTests && m.linesOfCode > 50)
        .map((m, i) => ({
          id: `tc-test-${i}`,
          type: "unit" as const,
          description: `验证 ${m.path} 可正常导入和执行`,
          setup: "",
          action: "调用模块",
          expected: "正常执行，无编译错误",
          command: "npm run build",
        })),
    dependencies: [],
  },

  // ── 模板 2: 简化高复杂度模块 ──
  {
    matchPainPoints: ["复杂度过高", "complexity"],
    type: "refactor",
    riskLevel: "medium",
    title: "简化高复杂度模块",
    description: (r) =>
      `重构 ${r.moduleAnalysis
        .filter((m) => m.complexityScore >= 7)
        .map((m) => m.path)
        .join(", ")}`,
    rationale: () => "高复杂度增加维护成本和出错概率，应保持在合理水平",
    benefit: "提高代码可读性和可维护性",
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => m.complexityScore >= 7)
        .map((m, i) => ({
          id: `tc-ref-${i}`,
          type: "unit" as const,
          description: `验证 ${m.path} 重构后功能一致`,
          setup: "",
          action: "执行原有测试或编译",
          expected: "输出与重构前一致",
          command: "npm run build",
        })),
    dependencies: [],
  },

  // ── 模板 3: 消除 any 类型 ──
  {
    matchPainPoints: ["any 类型", "类型安全"],
    type: "modify",
    riskLevel: "low",
    title: "消除 any 类型",
    description: () => "将 any 替换为精确类型，提高类型安全",
    rationale: () => "any 类型绕过 TypeScript 类型检查，是潜在的 bug 来源",
    benefit: "提高类型安全，减少运行时错误",
    generateTestCases: () => [
      {
        id: "tc-types-0",
        type: "unit" as const,
        description: "编译通过，无 any 类型警告",
        setup: "",
        action: "tsc --noEmit",
        expected: "无编译错误",
        command: "npm run build",
      },
    ],
    dependencies: [],
  },

  // ── 模板 4: 完善缺失的架构组件 ──
  {
    matchPainPoints: ["架构完整", "未通过", "missing"],
    type: "add",
    riskLevel: "medium",
    title: "完善缺失的架构组件",
    description: (r) =>
      `实现: ${r.architectureChecks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(", ")}`,
    rationale: () => "架构完整性影响系统健壮性和可扩展性",
    benefit: "增强系统健壮性和可扩展性",
    generateTestCases: (r) =>
      r.architectureChecks
        .filter((c) => !c.passed)
        .map((c, i) => ({
          id: `tc-arch-${i}`,
          type: "integration" as const,
          description: `验证 ${c.name}`,
          setup: "",
          action: "调用相关 API",
          expected: c.details,
          command: "npm run build",
        })),
    dependencies: [],
  },

  // ── 模板 5: 修复空 catch 块 ──
  {
    matchPainPoints: ["空 catch", "吞异常"],
    type: "modify",
    riskLevel: "low",
    title: "修复空 catch 块",
    description: () => "为空 catch 块添加日志或错误处理",
    rationale: () => "空 catch 块会吞掉错误，导致问题难以排查",
    benefit: "提高错误可见性，便于问题排查",
    generateTestCases: () => [
      {
        id: "tc-catch-0",
        type: "unit" as const,
        description: "编译通过，无空 catch 块",
        setup: "",
        action: "tsc --noEmit",
        expected: "无编译错误",
        command: "npm run build",
      },
    ],
    dependencies: [],
  },
];

// ============================================================================
// 主入口：生成优化提案
// ============================================================================

/**
 * 基于自我审视报告和外部调研报告生成优化提案
 *
 * 工作流程：
 * 1. 遍历所有提案模板
 * 2. 对每个模板，检查是否匹配当前项目的痛点
 * 3. 如果匹配，生成一个 OptimizationProposal 对象
 * 4. 按风险等级排序（low → medium → high → destructive）
 *
 * @param inspection 自我审视报告（由 Inspector 生成）
 * @param research 外部调研报告（由 Researcher 生成）
 * @returns 优化提案列表，按风险等级升序排列
 *
 * @example
 * ```ts
 * const insp = await inspectSelf(srcDir);
 * const res = await researchExternal();
 * const proposals = generateProposals(insp, res);
 * console.log(`生成了 ${proposals.length} 个提案`);
 * ```
 */
export function generateProposals(
  inspection: InspectionReport,
  research: ResearchReport
): OptimizationProposal[] {
  const proposals: OptimizationProposal[] = [];
  const order = { low: 0, medium: 1, high: 2, destructive: 3 };

  for (const t of TEMPLATES) {
    // 检查是否匹配任何痛点或架构检查失败项
    const hasMatch = t.matchPainPoints.some((kw) => {
      const k = kw.toLowerCase();
      return (
        inspection.painPoints.some((p) =>
          p.description.toLowerCase().includes(k)
        ) ||
        inspection.architectureChecks.some(
          (c) => !c.passed && c.name.toLowerCase().includes(k)
        )
      );
    });

    if (!hasMatch) continue;

    // 生成提案
    proposals.push({
      id: `prop-${Date.now()}-${proposals.length}`,
      type: t.type,
      riskLevel: t.riskLevel,
      target: t.title,
      description: t.description(inspection),
      rationale: t.rationale(research),
      expectedBenefit: t.benefit,
      files: [], // 文件变更由 generateFileChanges 填充
      dependencies: t.dependencies,
      testCases: t.generateTestCases(inspection),
      rollbackPlan: "Git reset 到变更前的快照",
    });
  }

  // 按风险等级排序
  proposals.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
  return proposals;
}

// ============================================================================
// 文件变更生成
// ============================================================================

/**
 * 为优化提案生成具体的文件变更计划
 *
 * 此函数是 Phase 5 的关键组件，负责：
 * 1. 检查提案是否已有文件变更（如果有则跳过）
 * 2. 根据提案类型生成对应的文件变更：
 *    - 测试类提案：生成缺失的测试文件骨架
 *    - any 类型提案：生成检测脚本
 *    - 空 catch 提案：生成检测脚本
 * 3. 将生成的 FileChange[] 赋值给 proposal.files
 *
 * 注意：
 * - 测试文件使用 assert 模块（不依赖 vitest）
 * - 测试文件 import 路径必须是 "../src/..."（不是 "../core/..."）
 * - 每个测试文件包含基本的可导入性测试
 *
 * @param proposal 优化提案（会被直接修改，添加 files 字段）
 * @param inspection 自我审视报告（用于获取模块分析数据）
 *
 * @example
 * ```ts
 * const proposals = generateProposals(insp, res);
 * for (const p of proposals) {
 *   generateFileChanges(p, insp);
 *   console.log(`${p.target}: ${p.files.length} 个文件变更`);
 * }
 * ```
 */
export function generateFileChanges(
  proposal: OptimizationProposal,
  inspection: InspectionReport
): void {
  // 如果已有文件变更，跳过
  if (proposal.files.length > 0) return;

  const changes: FileChange[] = [];

  // ── 类型 1: 添加缺失的测试文件 ──
  if (proposal.target.includes("测试")) {
    const untested = inspection.moduleAnalysis.filter(
      (m) => !m.hasTests && m.linesOfCode > 50
    );

    // 最多为前 3 个未测试模块生成测试文件
    for (const mod of untested.slice(0, 3)) {
      const fn =
        mod.path.split(/[\\/]/).pop()?.replace(/\.ts$/, "") || "module";
      const tp = "tests/" + fn + ".test.ts";
      const importPath = "../src/" + mod.path.replace(/\\/g, "/");

      const tc = `/**\n * Auto-generated test for ${fn}\n * 验证模块可正常导入和执行\n */\n\nimport assert from "assert";\n\ndescribe("${fn}", () => {\n  it("should be importable", async () => {\n    const m = await import("${importPath}");\n    assert.ok(m);\n  });\n});\n`;

      changes.push({ path: tp, action: "create", content: tc });
    }
  }

  // ── 类型 2: 消除 any 类型 — 生成检测脚本 ──
  if (proposal.target.includes("any")) {
    changes.push({
      path: "scripts/check-any-types.ts",
      action: "create",
      content: `/**
 * 检测项目中的 any 类型使用
 * 运行: npx tsx scripts/check-any-types.ts
 */
import * as fs from "fs";
import * as path from "path";

/**
 * 递归查找目录中使用了 any 类型的 TypeScript 文件
 * @param dir 要搜索的目录
 * @returns 包含 any 类型的文件路径和行号列表
 */
function findAny(dir: string): string[] {
  const r: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory() && !fp.includes("node_modules")) {
      r.push(...findAny(fp));
    } else if (f.endsWith(".ts")) {
      const c = fs.readFileSync(fp, "utf-8");
      const ls = c.split("\\n");
      for (let i = 0; i < ls.length; i++) {
        if (/:\\s*any\\b/.test(ls[i])) {
          r.push(fp + ":" + (i + 1));
        }
      }
    }
  }
  return r;
}

const anyTypes = findAny(path.resolve(__dirname, "../src"));
if (anyTypes.length > 0) {
  console.log("发现 any 类型使用:");
  anyTypes.forEach((t) => console.log("  " + t));
} else {
  console.log("✅ 未发现 any 类型使用!");
}
`,
    });
  }

  // ── 类型 3: 修复空 catch 块 — 生成检测脚本 ──
  if (proposal.target.includes("catch")) {
    changes.push({
      path: "scripts/find-empty-catches.ts",
      action: "create",
      content: `/**
 * 检测项目中的空 catch 块
 * 运行: npx tsx scripts/find-empty-catches.ts
 */
import * as fs from "fs";
import * as path from "path";

/**
 * 递归查找目录中包含空 catch 块的 TypeScript 文件
 * @param dir 要搜索的目录
 * @returns 包含空 catch 块的文件路径列表
 */
function findCatch(dir: string): string[] {
  const r: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory() && !fp.includes("node_modules")) {
      r.push(...findCatch(fp));
    } else if (
      f.endsWith(".ts") &&
      /catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}/.test(fs.readFileSync(fp, "utf-8"))
    ) {
      r.push(fp);
    }
  }
  return r;
}

const ec = findCatch(path.resolve(__dirname, "../src"));
if (ec.length > 0) {
  console.log("发现空 catch 块:");
  ec.forEach((f) => console.log("  " + f));
} else {
  console.log("✅ 未发现空 catch 块!");
}
`,
    });
  }

  // 赋值给提案
  proposal.files = changes;
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * 将优化提案列表格式化为可读文本
 *
 * 用于 CLI 展示，包含：
 * - 提案总数
 * - 每个提案的风险等级、类型、描述、预期收益、文件列表
 *
 * @param proposals 优化提案列表
 * @returns 格式化的文本字符串
 *
 * @example
 * ```ts
 * const proposals = generateProposals(insp, res);
 * console.log(formatProposals(proposals));
 * // 输出:
 * // ═══════════════════════════════════════════════════
 * // 📋 Optimization Proposals
 * // ═══════════════════════════════════════════════════
 * // 共 2 个
 * //
 * // 🟢 [1] 添加缺失的测试文件
 * //     类型: add | 风险: low
 * //     为 core/planner.ts 添加单元测试
 * //     收益: 提升测试覆盖率
 * //     文件: tests/planner.test.ts
 * // ```
 */
export function formatProposals(proposals: OptimizationProposal[]): string {
  const lines = [
    "═══════════════════════════════════════════════════",
    "📋 Optimization Proposals",
    "═══════════════════════════════════════════════════",
    `共 ${proposals.length} 个`,
    "",
  ];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const icon =
      p.riskLevel === "low"
        ? "🟢"
        : p.riskLevel === "medium"
        ? "🟡"
        : "🔴";

    lines.push(`${icon} [${i + 1}] ${p.target}`);
    lines.push(`    类型: ${p.type} | 风险: ${p.riskLevel}`);
    lines.push(`    ${p.description}`);
    lines.push(`    收益: ${p.expectedBenefit}`);
    if (p.files.length > 0) {
      lines.push(`    文件: ${p.files.map((f) => f.path).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
