/**
 * @file inspector.ts — Self-Inspection 自我审视引擎
 * @description
 *   读取项目源码，分析代码质量、架构完整性、痛点，生成自我审视报告。
 *
 *   分析维度：
 *   1. 代码质量指标：文件数、行数、导出数、测试覆盖率等
 *   2. 模块分析：每个核心模块的复杂度、依赖、是否有测试
 *   3. 架构完整性：对照 types.ts 检查各子系统是否完整实现
 *   4. 痛点分析：从性能监控、循环检测日志中提取问题
 *
 *   设计原则：
 *   - 静态分析为主，不调用 LLM
 *   - 所有数据来自实际文件系统，不编造
 *   - 结果可量化、可追踪
 *
 * @module core/self-opt/inspector
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  InspectionReport,
  CodeQualityMetric,
  ModuleAnalysis,
  ArchitectureCheck,
} from "./types.js";

// ============================================================================
// 配置
// ============================================================================

/** 核心源码目录 */
const CORE_MODULES = [
  "core/agent.ts",
  "core/planner.ts",
  "core/registry.ts",
  "core/monitor.ts",
  "core/config.ts",
  "core/types.ts",
  "core/output-manager.ts",
  "core/loop-detector.ts",
  "core/skill-registry.ts",
  "core/skill-loader.ts",
  "core/clawhub-client.ts",
  "toolboxes.ts",
  "cli.ts",
  "index.ts",
];

/** 工具目录 */
const TOOL_FILES = [
  "tools/filesystem.ts",
  "tools/exec.ts",
  "tools/web.ts",
  "tools/skills.ts",
];

/** 安全模块 */
const SECURITY_FILES = ["security/sandbox.ts"];

/** 架构完整性检查清单 */
interface ArchitectureExpectation {
  name: string;
  description: string;
  expectedFiles: string[];
  checks: { label: string; validate: (ctx: CheckContext) => boolean | string }[];
}

interface CheckContext {
  srcDir: string;
  fileContents: Map<string, string>;
  allFiles: string[];
}

const ARCHITECTURE_CHECKS: ArchitectureExpectation[] = [
  {
    name: "两阶段架构 (Plan-then-Execute)",
    description: "Phase 1 规划 + Phase 2 执行",
    expectedFiles: ["core/planner.ts", "core/agent.ts"],
    checks: [
      {
        label: "规划器存在且导出 generatePlan",
        validate: (ctx) => {
          const content = ctx.fileContents.get("core/planner.ts") || "";
          return content.includes("export") && content.includes("generatePlan");
        },
      },
      {
        label: "Agent 支持两阶段模式",
        validate: (ctx) => {
          const content = ctx.fileContents.get("core/agent.ts") || "";
          return content.includes("runAgent") && content.includes("plan");
        },
      },
    ],
  },
  {
    name: "工具箱系统 (Toolbox System)",
    description: "粗粒度能力分组，支持 Phase 1 筛选",
    expectedFiles: ["toolboxes.ts"],
    checks: [
      {
        label: "工具箱定义存在",
        validate: (ctx) => {
          const content = ctx.fileContents.get("toolboxes.ts") || "";
          return content.includes("Toolbox") && content.includes("export");
        },
      },
      {
        label: "工具关联到工具箱",
        validate: (ctx) => {
          for (const tf of TOOL_FILES) {
            const content = ctx.fileContents.get(tf) || "";
            if (content.includes("toolbox")) return true;
          }
          return "未在任何工具文件中找到 toolbox 字段";
        },
      },
    ],
  },
  {
    name: "技能系统 (Skill System)",
    description: "可插拔模块化扩展",
    expectedFiles: ["core/skill-registry.ts", "core/skill-loader.ts"],
    checks: [
      {
        label: "技能注册表存在",
        validate: (ctx) => ctx.fileContents.has("core/skill-registry.ts"),
      },
      {
        label: "技能加载器存在",
        validate: (ctx) => ctx.fileContents.has("core/skill-loader.ts"),
      },
      {
        label: "技能目录存在",
        validate: (ctx) => {
          const skillsDir = path.join(ctx.srcDir, "..", "skills");
          return fs.existsSync(skillsDir);
        },
      },
    ],
  },
  {
    name: "安全沙箱 (Sandbox)",
    description: "路径验证 + 权限分级",
    expectedFiles: ["security/sandbox.ts"],
    checks: [
      {
        label: "沙箱模块存在",
        validate: (ctx) => ctx.fileContents.has("security/sandbox.ts"),
      },
      {
        label: "路径验证函数存在",
        validate: (ctx) => {
          const content = ctx.fileContents.get("security/sandbox.ts") || "";
          return content.includes("resolveSandboxPath") || content.includes("isPathAllowed");
        },
      },
    ],
  },
  {
    name: "性能监控 (Monitor)",
    description: "工具调用统计",
    expectedFiles: ["core/monitor.ts"],
    checks: [
      {
        label: "监控器存在",
        validate: (ctx) => ctx.fileContents.has("core/monitor.ts"),
      },
      {
        label: "记录调用统计",
        validate: (ctx) => {
          const content = ctx.fileContents.get("core/monitor.ts") || "";
          return content.includes("calls") || content.includes("record");
        },
      },
    ],
  },
  {
    name: "循环检测 (Loop Detection)",
    description: "防止无限循环",
    expectedFiles: ["core/loop-detector.ts"],
    checks: [
      {
        label: "循环检测器存在",
        validate: (ctx) => ctx.fileContents.has("core/loop-detector.ts"),
      },
    ],
  },
  {
    name: "配置系统 (Config)",
    description: "双层配置 + 预设",
    expectedFiles: ["core/config.ts"],
    checks: [
      {
        label: "配置模块存在",
        validate: (ctx) => ctx.fileContents.has("core/config.ts"),
      },
      {
        label: "预设支持",
        validate: (ctx) => {
          const content = ctx.fileContents.get("core/config.ts") || "";
          return content.includes("MODEL_PROFILES") || content.includes("profiles");
        },
      },
    ],
  },
  {
    name: "测试覆盖 (Test Coverage)",
    description: "集成测试",
    expectedFiles: ["tests/test.ts"],
    checks: [
      {
        label: "测试文件存在",
        validate: (ctx) => ctx.fileContents.has("tests/test.ts"),
      },
      {
        label: "至少 1 个测试用例",
        validate: (ctx) => {
          const content = ctx.fileContents.get("tests/test.ts") || "";
          const testCount = (content.match(/PASS|✅/g) || []).length;
          return testCount > 0 ? true : `仅 ${testCount} 个测试用例`;
        },
      },
    ],
  },
];

// ============================================================================
// 工具函数
// ============================================================================

/** 递归统计目录下的 .ts 文件数 */
function countTsFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        count += countTsFiles(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        count++;
      }
    }
  } catch {
    // ignore
  }
  return count;
}

/** 统计总代码行数 */
function countTotalLines(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") {
        total += countTotalLines(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          total += content.split("\n").length;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return total;
}

/** 统计导出数量 */
function countExports(content: string): number {
  const exportMatches = content.match(/export\s+(default\s+|const\s+|function\s+|class\s+|interface\s+|type\s+)/g);
  return exportMatches ? exportMatches.length : 0;
}

/** 统计导入数量 */
function countImports(content: string): number {
  const importMatches = content.match(/^import\s+/gm);
  return importMatches ? importMatches.length : 0;
}

/** 估算复杂度（基于控制流关键字密度） */
function estimateComplexity(content: string): number {
  const lines = content.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  if (lines.length === 0) return 1;

  const controlFlow = (content.match(/\b(if|else|for|while|switch|case|catch|try|return)\b/g) || []).length;
  const nesting = (content.match(/\{/g) || []).length;
  const density = (controlFlow + nesting) / lines.length;

  if (density > 0.5) return 9;
  if (density > 0.35) return 7;
  if (density > 0.25) return 5;
  if (density > 0.15) return 3;
  return 1;
}

/** 检查文件是否有对应测试 */
function hasCorrespondingTest(srcPath: string, testDir: string): boolean {
  const baseName = path.basename(srcPath, ".ts");
  const testFile = path.join(testDir, `${baseName}.test.ts`);
  if (fs.existsSync(testFile)) return true;

  // 检查 tests/ 目录下是否有引用该文件的测试
  try {
    const testContent = fs.readFileSync(path.join(testDir, "test.ts"), "utf-8");
    return testContent.includes(baseName) || testContent.includes(srcPath);
  } catch {
    return false;
  }
}

/** 常见问题检测 */
function detectIssues(content: string, filePath: string): string[] {
  const issues: string[] = [];

  // 检查空 catch 块
  if (/catch\s*\(\s*\)\s*\{\s*\}/.test(content)) {
    issues.push("存在空 catch 块（吞异常）");
  }

  // 检查 any 类型滥用
  const anyCount = (content.match(/:\s*any\b/g) || []).length;
  if (anyCount > 5) {
    issues.push(`any 类型使用过多 (${anyCount} 处)`);
  }

  // 检查超长函数（> 50 行）
  const lines = content.split("\n");
  let inFunction = false;
  let funcStart = 0;
  let braceCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(async\s+)?function\s+\w+|^\s*\w+\s*=\s*(async\s+)?\(/.test(line)) {
      inFunction = true;
      funcStart = i;
      braceCount = 0;
    }
    if (inFunction) {
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;
      if (braceCount <= 0 && i > funcStart) {
        if (i - funcStart > 50) {
          issues.push(`存在超长函数 (${i - funcStart + 1} 行)`);
        }
        inFunction = false;
      }
    }
  }

  // 检查 console.log（生产代码中应减少）
  const consoleLogCount = (content.match(/console\.(log|warn|error)/g) || []).length;
  if (consoleLogCount > 10) {
    issues.push(`console 输出过多 (${consoleLogCount} 处)`);
  }

  return issues;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行自我审视
 *
 * @param srcDir 项目 src/ 目录路径
 * @returns 自我审视报告
 */
export async function inspectSelf(srcDir: string): Promise<InspectionReport> {
  const projectRoot = path.resolve(srcDir, "..");
  const testDir = path.join(projectRoot, "tests");

  // ── 读取所有文件内容 ──
  const allFiles = [...CORE_MODULES, ...TOOL_FILES, ...SECURITY_FILES, "tests/test.ts"];
  const fileContents = new Map<string, string>();
  for (const file of allFiles) {
    const fullPath = path.join(srcDir, file);
    try {
      fileContents.set(file, fs.readFileSync(fullPath, "utf-8"));
    } catch {
      fileContents.set(file, "");
    }
  }

  const checkCtx: CheckContext = {
    srcDir,
    fileContents,
    allFiles,
  };

  // ── 1. 代码质量指标 ──
  const tsFileCount = countTsFiles(srcDir);
  const totalLines = countTotalLines(srcDir);

  // 统计总导出数
  let totalExports = 0;
  for (const [, content] of fileContents) {
    totalExports += countExports(content);
  }

  // 统计测试覆盖
  let modulesWithTests = 0;
  for (const file of CORE_MODULES) {
    if (hasCorrespondingTest(file, testDir)) modulesWithTests++;
  }
  const testCoverage = CORE_MODULES.length > 0 ? Math.round((modulesWithTests / CORE_MODULES.length) * 100) : 0;

  // 统计类型定义覆盖
  const typesContent = fileContents.get("core/types.ts") || "";
  const interfaceCount = (typesContent.match(/interface\s+\w+/g) || []).length;
  const typeAliasCount = (typesContent.match(/type\s+\w+/g) || []).length;

  const qualityMetrics: CodeQualityMetric[] = [
    {
      name: "TypeScript 文件数",
      value: tsFileCount,
      passed: tsFileCount > 5,
    },
    {
      name: "总代码行数",
      value: totalLines,
      passed: totalLines > 100,
      note: `${CORE_MODULES.length} 个核心模块 + ${TOOL_FILES.length} 个工具模块`,
    },
    {
      name: "测试覆盖率",
      value: `${testCoverage}%`,
      target: "100%",
      passed: testCoverage >= 80,
      note: `${modulesWithTests}/${CORE_MODULES.length} 个核心模块有测试`,
    },
    {
      name: "类型定义数",
      value: `${interfaceCount} interfaces + ${typeAliasCount} types`,
      passed: interfaceCount > 10,
      note: "类型定义越完善，代码越安全",
    },
    {
      name: "导出总数",
      value: totalExports,
      passed: totalExports > 20,
      note: "导出越多，模块化程度越高",
    },
  ];

  // ── 2. 模块分析 ──
  const moduleAnalysis: ModuleAnalysis[] = [];

  for (const file of [...CORE_MODULES, ...TOOL_FILES, ...SECURITY_FILES]) {
    const content = fileContents.get(file) || "";
    const loc = content.split("\n").length;
    const issues = detectIssues(content, file);

    moduleAnalysis.push({
      path: file,
      linesOfCode: loc,
      hasTests: hasCorrespondingTest(file, testDir),
      exportsCount: countExports(content),
      importsCount: countImports(content),
      complexityScore: estimateComplexity(content),
      issues,
    });
  }

  // ── 3. 架构完整性检查 ──
  const architectureChecks: ArchitectureCheck[] = [];

  for (const check of ARCHITECTURE_CHECKS) {
    for (const subCheck of check.checks) {
      const result = subCheck.validate(checkCtx);
      const passed = typeof result === "boolean" ? result : false;
      architectureChecks.push({
        name: `${check.name} — ${subCheck.label}`,
        passed,
        details: check.description,
        recommendation: passed ? undefined : typeof result === "string" ? result : `需要完善：${subCheck.label}`,
      });
    }
  }

  // ── 4. 痛点分析 ──
  const painPoints: InspectionReport["painPoints"] = [];

  // 从模块分析中提取痛点
  const allIssues = moduleAnalysis.flatMap((m) => m.issues.map((issue) => ({ module: m.path, issue })));
  for (const { module, issue } of allIssues) {
    painPoints.push({
      description: `${module}: ${issue}`,
      severity: issue.includes("any 类型") || issue.includes("空 catch") ? "medium" : "low",
      evidence: `代码分析检测`,
    });
  }

  // 测试覆盖不足
  const untestedModules = moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
  for (const m of untestedModules) {
    painPoints.push({
      description: `${m.path} 没有对应测试 (${m.linesOfCode} 行)`,
      severity: "high",
      evidence: `文件存在但无测试覆盖`,
    });
  }

  // 高复杂度模块
  const complexModules = moduleAnalysis.filter((m) => m.complexityScore >= 7);
  for (const m of complexModules) {
    painPoints.push({
      description: `${m.path} 复杂度过高 (评分: ${m.complexityScore}/10)`,
      severity: "medium",
      evidence: `控制流密度分析`,
    });
  }

  // ── 5. 优化建议 ──
  const suggestions: string[] = [];

  if (testCoverage < 80) {
    suggestions.push(`提升测试覆盖率至 80%+（当前 ${testCoverage}%）`);
  }
  if (complexModules.length > 0) {
    suggestions.push(`简化 ${complexModules.length} 个高复杂度模块`);
  }
  if (untestedModules.length > 0) {
    suggestions.push(`为 ${untestedModules.length} 个大型模块添加测试`);
  }
  suggestions.push("考虑添加循环检测的自定义检测器");
  suggestions.push("考虑添加配置验证工具");
  suggestions.push("考虑添加工具调用链路追踪");

  // ── 6. 总评 ──
  const passedChecks = architectureChecks.filter((c) => c.passed).length;
  const totalChecks = architectureChecks.length;
  const healthScore = Math.round((passedChecks / Math.max(totalChecks, 1)) * 100);

  let summary = "";
  if (healthScore >= 90) {
    summary = `架构完整度 ${healthScore}%，整体健康。主要改进空间：${suggestions.slice(0, 2).join("、")}。`;
  } else if (healthScore >= 70) {
    summary = `架构完整度 ${healthScore}%，部分子系统待完善。建议优先处理：${suggestions.slice(0, 3).join("、")}。`;
  } else {
    summary = `架构完整度 ${healthScore}%，存在明显缺陷。建议立即关注：${suggestions.slice(0, 3).join("、")}。`;
  }

  return {
    timestamp: new Date().toISOString(),
    version: requireVersion(projectRoot),
    qualityMetrics,
    moduleAnalysis,
    architectureChecks,
    painPoints,
    suggestions,
    summary,
  };
}

/** 从 package.json 读取版本号 */
function requireVersion(projectRoot: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
