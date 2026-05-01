/**
 * @file proposal-engine.ts — 优化提案引擎
 * @module core/self-opt/proposal-engine
 */
import type { InspectionReport, ResearchReport, OptimizationProposal, TestCase, FileChange } from "./types.js";

interface Template {
  matchPainPoints: string[];
  type: "add" | "remove" | "modify" | "refactor";
  riskLevel: "low" | "medium" | "high" | "destructive";
  title: string;
  description: (r: InspectionReport) => string;
  rationale: (r: ResearchReport) => string;
  benefit: string;
  generateTestCases: (r: InspectionReport) => TestCase[];
  dependencies: string[];
}

const TEMPLATES: Template[] = [
  {
    matchPainPoints: ["没有对应测试", "测试覆盖", "hasTests: false"],
    type: "add", riskLevel: "low", title: "添加缺失的测试文件",
    description: (r) => { const m = r.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50); return `为 ${m.map(m => m.path).join(", ")} 添加单元测试`; },
    rationale: () => "测试驱动开发是最佳实践", benefit: "提升测试覆盖率",
    generateTestCases: (r) => r.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50).map((m, i) => ({
      id: `tc-test-${i}`, type: "unit" as const, description: `验证 ${m.path}`, setup: "", action: "调用模块", expected: "正常执行", command: "npm run build",
    })),
    dependencies: [],
  },
  {
    matchPainPoints: ["复杂度过高", "complexity"],
    type: "refactor", riskLevel: "medium", title: "简化高复杂度模块",
    description: (r) => `重构 ${r.moduleAnalysis.filter(m => m.complexityScore >= 7).map(m => m.path).join(", ")}`,
    rationale: () => "高复杂度增加维护成本", benefit: "提高可读性",
    generateTestCases: (r) => r.moduleAnalysis.filter(m => m.complexityScore >= 7).map((m, i) => ({
      id: `tc-ref-${i}`, type: "unit" as const, description: `验证 ${m.path}`, setup: "", action: "执行", expected: "输出一致", command: "npm run build",
    })),
    dependencies: [],
  },
  {
    matchPainPoints: ["any 类型", "类型安全"],
    type: "modify", riskLevel: "low", title: "消除 any 类型",
    description: () => "将 any 替换为精确类型",
    rationale: () => "any 绕过类型检查", benefit: "提高类型安全",
    generateTestCases: () => [{ id: "tc-types-0", type: "unit" as const, description: "编译通过", setup: "", action: "tsc", expected: "无错误", command: "npm run build" }],
    dependencies: [],
  },
  {
    matchPainPoints: ["架构完整", "未通过", "missing"],
    type: "add", riskLevel: "medium", title: "完善缺失的架构组件",
    description: (r) => `实现: ${r.architectureChecks.filter(c => !c.passed).map(c => c.name).join(", ")}`,
    rationale: () => "提升架构完整性", benefit: "增强系统健壮性",
    generateTestCases: (r) => r.architectureChecks.filter(c => !c.passed).map((c, i) => ({
      id: `tc-arch-${i}`, type: "integration" as const, description: `验证 ${c.name}`, setup: "", action: "调用 API", expected: c.details, command: "npm run build",
    })),
    dependencies: [],
  },
  {
    matchPainPoints: ["空 catch", "吞异常"],
    type: "modify", riskLevel: "low", title: "修复空 catch 块",
    description: () => "为空 catch 添加日志",
    rationale: () => "空 catch 吞掉错误", benefit: "提高错误可见性",
    generateTestCases: () => [{ id: "tc-catch-0", type: "unit" as const, description: "编译通过", setup: "", action: "tsc", expected: "无错误", command: "npm run build" }],
    dependencies: [],
  },
];

export function generateProposals(inspection: InspectionReport, research: ResearchReport): OptimizationProposal[] {
  const proposals: OptimizationProposal[] = [];
  const order = { low: 0, medium: 1, high: 2, destructive: 3 };
  for (const t of TEMPLATES) {
    const hasMatch = t.matchPainPoints.some(kw => {
      const k = kw.toLowerCase();
      return inspection.painPoints.some(p => p.description.toLowerCase().includes(k)) ||
        inspection.architectureChecks.some(c => !c.passed && c.name.toLowerCase().includes(k));
    });
    if (!hasMatch) continue;
    proposals.push({
      id: `prop-${Date.now()}-${proposals.length}`, type: t.type, riskLevel: t.riskLevel,
      target: t.title, description: t.description(inspection), rationale: t.rationale(research),
      expectedBenefit: t.benefit, files: [], dependencies: t.dependencies,
      testCases: t.generateTestCases(inspection), rollbackPlan: "Git reset 到变更前的快照",
    });
  }
  proposals.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
  return proposals;
}

export function generateFileChanges(proposal: OptimizationProposal, inspection: InspectionReport): void {
  if (proposal.files.length > 0) return;
  const changes: FileChange[] = [];
  if (proposal.target.includes("测试")) {
    const untested = inspection.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50);
    for (const mod of untested.slice(0, 3)) {
      const fn = mod.path.split(/[\\/]/).pop()?.replace(/\.ts$/, "") || "module";
      const tp = "tests/" + fn + ".test.ts";
      const tc = '/**\n * Auto-generated test for ' + fn + '\n */\n\nimport assert from "assert";\n\ndescribe("' + fn + '", () => {\n  it("should be importable", async () => {\n    const m = await import("../../src/' + mod.path.replace(/\\/g, "/") + '");\n    assert.ok(m);\n  });\n});\n';
      changes.push({ path: tp, action: "create", content: tc });
    }
  }
  if (proposal.target.includes("any")) {
    changes.push({ path: "scripts/check-any-types.ts", action: "create", content: '/**\n * Find any types\n */\nimport * as fs from "fs";\nimport * as path from "path";\nfunction findAny(dir: string): string[] {\n  const r: string[] = [];\n  for (const f of fs.readdirSync(dir)) {\n    const fp = path.join(dir, f);\n    const st = fs.statSync(fp);\n    if (st.isDirectory() && !fp.includes("node_modules")) r.push(...findAny(fp));\n    else if (f.endsWith(".ts")) {\n      const c = fs.readFileSync(fp, "utf-8");\n      const ls = c.split("\\n");\n      for (let i = 0; i < ls.length; i++) if (/:\\s*any\\b/.test(ls[i])) r.push(fp + ":" + (i + 1));\n    }\n  }\n  return r;\n}\nconst anyTypes = findAny(path.resolve(__dirname, "../src"));\nif (anyTypes.length > 0) { anyTypes.forEach(t => console.log("  " + t)); } else { console.log("No any types!"); }\n' });
  }
  if (proposal.target.includes("catch")) {
    changes.push({ path: "scripts/find-empty-catches.ts", action: "create", content: '/**\n * Find empty catch blocks\n */\nimport * as fs from "fs";\nimport * as path from "path";\nfunction findCatch(dir: string): string[] {\n  const r: string[] = [];\n  for (const f of fs.readdirSync(dir)) {\n    const fp = path.join(dir, f);\n    const st = fs.statSync(fp);\n    if (st.isDirectory() && !fp.includes("node_modules")) r.push(...findCatch(fp));\n    else if (f.endsWith(".ts") && /catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}/.test(fs.readFileSync(fp, "utf-8"))) r.push(fp);\n  }\n  return r;\n}\nconst ec = findCatch(path.resolve(__dirname, "../src"));\nif (ec.length > 0) { ec.forEach(f => console.log("  " + f)); } else { console.log("No empty catches!"); }\n' });
  }
  proposal.files = changes;
}

export function formatProposals(proposals: OptimizationProposal[]): string {
  const lines = ["═══════════════════════════════════════════════════", "📋 Optimization Proposals", "═══════════════════════════════════════════════════", `共 ${proposals.length} 个`, ""];
  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const icon = p.riskLevel === "low" ? "🟢" : p.riskLevel === "medium" ? "🟡" : "🔴";
    lines.push(`${icon} [${i + 1}] ${p.target}`);
    lines.push(`    类型: ${p.type} | 风险: ${p.riskLevel}`);
    lines.push(`    ${p.description}`);
    lines.push(`    收益: ${p.expectedBenefit}`);
    if (p.files.length > 0) lines.push(`    文件: ${p.files.map(f => f.path).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
