/**
 * @file inspector.ts — Self-Inspection Engine 自我审视引擎
 * @description
 *   读取项目源代码，分析代码质量、架构完整性、使用痛点，生成自我审视报告。
 *
 *   分析维度：
 *   1. 代码质量指标：文件数、总代码行数、测试覆盖率、类型定义覆盖
 *   2. 模块分析：每个模块的复杂度、导出数、是否有对应测试
 *   3. 架构完整性：基于 types.ts 定义的检查清单，验证系统是否按预期实现
 *   4. 使用痛点：高频失败、循环检测触发、日志分析
 *
 *   设计原则：
 *   - 静态分析为主，不依赖 LLM
 *   - 避免执行实际文件系统之外的操作
 *   - 输出结果可追溯、可验证
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
// 常量定义
// ============================================================================

/** 核心模块列表 */
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

/** 工具文件列表 */
const TOOL_FILES = [
  "tools/filesystem.ts",
  "tools/exec.ts",
  "tools/web.ts",
  "tools/skills.ts",
];

/** 安全模块列表 */
const SECURITY_FILES = ["security/sandbox.ts"];

/**
 * 架构检查项接口
 *
 * 每个检查项包含：
 * - name: 检查项名称
 * - description: 检查项描述
 * - expectedFiles: 期望存在的文件列表
 * - checks: 具体的验证逻辑
 */
interface ArchitectureExpectation {
  name: string;
  description: string;
  expectedFiles: string[];
  checks: {
    label: string;
    validate: (ctx: CheckContext) => boolean | string;
  }[];
}

/**
 * 检查上下文
 *
 * 提供给所有验证函数，用于访问项目信息。
 */
interface CheckContext {
  srcDir: string;
  fileContents: Map<string, string>;
  allFiles: string[];
}

/**
 * 架构完整性检查清单
 *
 * 当前定义 8 个架构维度：
 * 1. 两阶段架构 (Plan-then-Execute)
 * 2. 工具箱系统 (Toolbox System)
 * 3. 技能系统 (Skill System)
 * 4. 安全沙箱 (Sandbox)
 * 5. 性能监控 (Monitor)
 * 6. 循环检测 (Loop Detection)
 * 7. 配置系统 (Config)
 * 8. 测试覆盖 (Test Coverage)
 */
const ARCHITECTURE_CHECKS: ArchitectureExpectation[] = [
  // ── 检查 1: 两阶段架构 ──
  {
    name: "两阶段架构 (Plan-then-Execute)",
    description: "Phase 1 规划 + Phase 2 执行",
    expectedFiles: ["core/planner.ts", "core/agent.ts"],
    checks: [
      {
        label: "规划器已实现",
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

  // ── 检查 2: 工具箱系统 ──
  {
    name: "工具箱系统 (Toolbox System)",
    description: "工具按能力分组，支持 Phase 1 筛选",
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
        label: "工具文件引用工具箱",
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

  // ── 检查 3: 技能系统 ──
  {
    name: "技能系统 (Skill System)",
    description: "可插拔、模块化扩展",
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

  // ── 检查 4: 安全沙箱 ──
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
          return (
            content.includes("resolveSandboxPath") ||
            content.includes("isPathAllowed")
          );
        },
      },
    ],
  },

  // ── 检查 5: 性能监控 ──
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

  // ── 检查 6: 循环检测 ──
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

  // ── 检查 7: 配置系统 ──
  {
    name: "配置系统 (Config)",
    description: "双档配置 + 预设",
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
          return (
            content.includes("MODEL_PROFILES") || content.includes("profiles")
          );
        },
      },
    ],
  },

  // ── 检查 8: 测试覆盖 ──
  {
    name: "测试覆盖 (Test Coverage)",
    description: "不可或缺",
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
          const testCount = (content.match(/PASS|✓/g) || []).length;
          return testCount > 0 ? true : `共 ${testCount} 个测试用例`;
        },
      },
    ],
  },
];

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 递归统计目录下的 .ts 文件数量
 *
 * @param dir 要统计的目录路径
 * @returns .ts 文件数量
 */
function countTsFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        entry.name !== "dist"
      ) {
        count += countTsFiles(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        count++;
      }
    }
  } catch {
    // 忽略错误
  }
  return count;
}

/**
 * 统计总代码行数
 *
 * @param dir 要统计的目录路径
 * @returns 所有 .ts 文件的总行数
 */
function countTotalLines(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        entry.name !== "node_modules" &&
        entry.name !== "dist"
      ) {
        total += countTotalLines(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          total += content.split("\n").length;
        } catch {
          // 忽略读取失败的文件
        }
      }
    }
  } catch {
    // 忽略错误
  }
  return total;
}

/**
 * 统计导出数量
 *
 * 计算文件中使用 export 关键字的次数，
 * 包括 export default, export const, export function 等。
 *
 * @param content 文件内容
 * @returns 导出数量
 */
function countExports(content: string): number {
  const exportMatches = content.match(
    /export\s+(default\s+|const\s+|function\s+|class\s+|interface\s+|type\s+)/g
  );
  return exportMatches ? exportMatches.length : 0;
}

/**
 * 统计导入数量
 *
 * 计算文件中使用 import 关键字的次数。
 *
 * @param content 文件内容
 * @returns 导入数量
 */
function countImports(content: string): number {
  const importMatches = content.match(/^import\s+/gm);
  return importMatches ? importMatches.length : 0;
}

/**
 * 估算代码复杂度
 *
 * 基于控制流关键字密度和嵌套深度，
 * 返回 1-10 的复杂度评分。
 *
 * 评分标准：
 * - 1: 极简代码，几乎无控制流
 * - 3: 简单逻辑，少量条件分支
 * - 5: 中等复杂度，有一定嵌套
 * - 7: 高复杂度，控制流密集
 * - 9: 极高复杂度，需要重构
 *
 * @param content 文件内容
 * @returns 复杂度评分 (1-10)
 */
function estimateComplexity(content: string): number {
  const lines = content.split("\n").filter(
    (l) =>
      l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*")
  );
  if (lines.length === 0) return 1;

  const controlFlow = (
    content.match(
      /\b(if|else|for|while|switch|case|catch|try|return)\b/g
    ) || []
  ).length;
  const nesting = (content.match(/\{/g) || []).length;
  const density = (controlFlow + nesting) / lines.length;

  if (density > 0.5) return 9;
  if (density > 0.35) return 7;
  if (density > 0.25) return 5;
  if (density > 0.15) return 3;
  return 1;
}

/**
 * 检查模块是否有对应测试
 *
 * 查找规则：
 * 1. tests/<module>.test.ts 存在
 * 2. tests/test.ts 中引用了该模块
 *
 * @param srcPath 源文件路径（相对于 src/）
 * @param testDir 测试目录路径
 * @returns 是否有对应测试
 */
function hasCorrespondingTest(srcPath: string, testDir: string): boolean {
  const baseName = path.basename(srcPath, ".ts");
  const testFile = path.join(testDir, `${baseName}.test.ts`);
  if (fs.existsSync(testFile)) return true;

  // 检查 tests/ 目录下是否有引用该文件的测试
  try {
    const testContent = fs.readFileSync(
      path.join(testDir, "test.ts"),
      "utf-8"
    );
    return testContent.includes(baseName) || testContent.includes(srcPath);
  } catch {
    return false;
  }
}

/**
 * 检测代码问题
 *
 * 检查以下问题类型：
 * - 空 catch 块（吞异常）
 * - any 类型滥用（超过 5 处）
 * - 超长函数（> 50 行）
 * - console 日志过多（> 10 处）
 *
 * @param content 文件内容
 * @param filePath 文件路径（用于错误信息）
 * @returns 发现的问题列表
 */
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

  // 检查超长函数 (> 50 行)
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
          issues.push(`超长函数 (${i - funcStart + 1} 行)`);
        }
        inFunction = false;
      }
    }
  }

  // 检查 console.log（生产代码应很少）
  const consoleLogCount = (content.match(/console\.(log|warn|error)/g) || [])
    .length;
  if (consoleLogCount > 10) {
    issues.push(`console 调用过多 (${consoleLogCount} 处)`);
  }

  return issues;
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行自我审视
 *
 * 这是 Inspector 的主入口，执行以下分析步骤：
 * 1. 读取所有核心文件内容
 * 2. 计算代码质量指标（文件数、代码行数、测试覆盖率、类型定义覆盖、导出数量）
 * 3. 分析每个模块（复杂度、导出数、导入数、问题列表）
 * 4. 运行架构完整性检查（8 个维度）
 * 5. 提取痛点列表（模块问题、未测试模块、高复杂度模块）
 * 6. 生成优化建议
 * 7. 计算总评
 *
 * @param srcDir 项目 src/ 目录路径
 * @returns 自我审视报告
 *
 * @example
 * ```ts
 * const projectRoot = process.cwd();
 * const srcDir = path.join(projectRoot, "src");
 * const report = await inspectSelf(srcDir);
 * console.log(`架构通过率: ${report.architectureChecks.filter(c => c.passed).length}/${report.architectureChecks.length}`);
 * console.log(`未测试模块: ${report.moduleAnalysis.filter(m => !m.hasTests).length}`);
 * ```
 */
export async function inspectSelf(srcDir: string): Promise<InspectionReport> {
  const projectRoot = path.resolve(srcDir, "..");
  const testDir = path.join(projectRoot, "tests");

  // Step 1: 读取所有文件内容到 Map
  const allFiles = [
    ...CORE_MODULES,
    ...TOOL_FILES,
    ...SECURITY_FILES,
    "tests/test.ts",
  ];
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

  // Step 2: 代码质量指标
  const tsFileCount = countTsFiles(srcDir);
  const totalLines = countTotalLines(srcDir);

  // 统计总导出数
  let totalExports = 0;
  for (const [, content] of fileContents) {
    totalExports += countExports(content);
  }

  // 统计测试覆盖率
  let modulesWithTests = 0;
  for (const file of CORE_MODULES) {
    if (hasCorrespondingTest(file, testDir)) modulesWithTests++;
  }
  const testCoverage =
    CORE_MODULES.length > 0
      ? Math.round((modulesWithTests / CORE_MODULES.length) * 100)
      : 0;

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
      note: "类型定义越多，类型越安全",
    },
    {
      name: "导出总数",
      value: totalExports,
      passed: totalExports > 20,
      note: "导出越多，模块化程度越高",
    },
  ];

  // Step 3: 模块分析
  const moduleAnalysis: ModuleAnalysis[] = [];

  for (const file of [
    ...CORE_MODULES,
    ...TOOL_FILES,
    ...SECURITY_FILES,
  ]) {
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

  // Step 4: 架构完整性检查
  const architectureChecks: ArchitectureCheck[] = [];

  for (const check of ARCHITECTURE_CHECKS) {
    for (const subCheck of check.checks) {
      const result = subCheck.validate(checkCtx);
      const passed = typeof result === "boolean" ? result : false;
      architectureChecks.push({
        name: `${check.name} → ${subCheck.label}`,
        passed,
        details: check.description,
        recommendation: passed
          ? undefined
          : typeof result === "string"
          ? result
          : `需要实现：${subCheck.label}`,
      });
    }
  }

  // Step 5: 痛点分析
  const painPoints: InspectionReport["painPoints"] = [];

  // 模块问题提取为痛点
  const allIssues = moduleAnalysis.flatMap((m) =>
    m.issues.map((issue) => ({ module: m.path, issue }))
  );
  for (const { module, issue } of allIssues) {
    painPoints.push({
      description: `${module}: ${issue}`,
      severity:
        issue.includes("any 类型") || issue.includes("空 catch")
          ? "medium"
          : "low",
      evidence: `代码分析得出`,
    });
  }

  // 测试覆盖不足
  const untestedModules = moduleAnalysis.filter(
    (m) => !m.hasTests && m.linesOfCode > 50
  );
  for (const m of untestedModules) {
    painPoints.push({
      description: `${m.path} 没有对应测试 (${m.linesOfCode} 行)`,
      severity: "high",
      evidence: `文件存在但无测试覆盖`,
    });
  }

  // 高复杂度模块
  const complexModules = moduleAnalysis.filter(
    (m) => m.complexityScore >= 7
  );
  for (const m of complexModules) {
    painPoints.push({
      description: `${m.path} 复杂度过高 (评分: ${m.complexityScore}/10)`,
      severity: "medium",
      evidence: `控制流密度分析`,
    });
  }

  // Step 6: 优化建议
  const suggestions: string[] = [];

  if (testCoverage < 80) {
    suggestions.push(`提升测试覆盖率到 80%+（当前 ${testCoverage}%）`);
  }
  if (complexModules.length > 0) {
    suggestions.push(`重构 ${complexModules.length} 个高复杂度模块`);
  }
  if (untestedModules.length > 0) {
    suggestions.push(`为 ${untestedModules.length} 个未测试模块添加测试`);
  }
  suggestions.push("实现循环检测自动修复能力");
  suggestions.push("增加端到端测试验证完整流程");
  suggestions.push("添加工具调用的路径追踪");

  // Step 7: 总评
  const passedChecks = architectureChecks.filter((c) => c.passed).length;
  const totalChecks = architectureChecks.length;
  const healthScore = Math.round(
    (passedChecks / Math.max(totalChecks, 1)) * 100
  );

  let summary = "";
  if (healthScore >= 90) {
    summary = `架构通过率 ${healthScore}%，系统健康，需要改进的：${suggestions.slice(0, 2).join("、")}。`;
  } else if (healthScore >= 70) {
    summary = `架构通过率 ${healthScore}%，核心系统已完善。建议优先处理：${suggestions.slice(0, 3).join("、")}。`;
  } else {
    summary = `架构通过率 ${healthScore}%，系统存在缺陷。建议重点关注：${suggestions.slice(0, 3).join("、")}。`;
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

/**
 * 从 package.json 读取版本号
 *
 * @param projectRoot 项目根目录
 * @returns 版本号，如果读取失败返回 "unknown"
 */
function requireVersion(projectRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8")
    );
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
