/**
 * @file inspector.ts - Self-Inspection Engine 自检查引擎 (Phase 5.2 升级)
 * @description
 *   获取项目源代码，执行代码质量分析、架构合规检查、使用痛点分析，生成自检报告。
 *
 *   Phase 5.1 升级：
 *   - 动态模块发现：扫描 src/ 下所有 .ts 文件，不再硬编码模块列表
 *   - 自动分组：按目录自动分组（core/, tools/, security/, types/ 等）
 *   - 核心文件特殊检查：保留对关键架构文件的专项检查
 *
 *   Phase 5.2 升级：
 *   - 接入运行时错误数据：可选传入 errorLogPath，运行时错误优先级 > 静态分析
 *
 *   分析维度：
 *   1. 代码质量指标：文件数、总代码行数、测试覆盖率、类型定义覆盖、导出函数数
 *   2. 模块分析：每个模块的复杂度、依赖关系、是否有对应测试
 *   3. 架构合规检查：验证 types.ts 声明文件清单，验证系统是否按预期实现
 *   4. 使用痛点：高频失败、循环检测触发、日志告警等 + 运行时错误
 *
 *   设计原则
 *   - 静态分析为主，动态数据为辅（Phase 5.2 接入运行时数据）
 *   - 避免直接执行实际文件系统之外的操作
 *   - 所有检查可追溯、可验证
 *
 * @module core/self-opt/inspector
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  InspectionReport,
  CodeQualityMetric,
  ModuleAnalysis,
  ArchitectureCheck,
} from './types.js';
import { analyzeErrors, injectErrorsIntoInspection } from './error-analyzer.js';

// ============================================================================
// 动态模块扫描
// ============================================================================

/**
 * 核心架构文件（保留特殊检查）
 */
const CORE_FILES = new Set([
  'core/agent.ts',
  'core/planner.ts',
  'core/monitor.ts',
  'core/config.ts',
  'core/loop-detector.ts',
  'core/skill-registry.ts',
  'core/skill-loader.ts',
]);

/**
 * 递归扫描 src/ 目录下所有 .ts 文件
 * @param srcDir src 目录路径
 * @returns 相对路径列表（相对于 srcDir）
 */
export function scanTsFiles(srcDir: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
          walk(fp);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          results.push(path.relative(srcDir, fp).replace(/\\/g, '/'));
        }
      }
    } catch { /* ignore */ }
  }
  walk(srcDir);
  return results.sort();
}

// ============================================================================
// 架构检查
// ============================================================================

interface CheckContext {
  srcDir: string;
  fileContents: Map<string, string>;
  allFiles: string[];
}

interface ArchitectureExpectation {
  name: string;
  description: string;
  expectedFiles: string[];
  checks: { label: string; validate: (ctx: CheckContext) => boolean | string }[];
}

const ARCHITECTURE_CHECKS: ArchitectureExpectation[] = [
  {
    name: '两阶段架构 (Plan-then-Execute)',
    description: 'Phase 1 规划 + Phase 2 执行',
    expectedFiles: ['core/planner.ts', 'core/agent.ts'],
    checks: [
      {
        label: 'Planner 模块实现',
        validate: (ctx) => {
          const c = ctx.fileContents.get('core/planner.ts') || '';
          return c.includes('export') && c.includes('generatePlan')
            ? true : '缺少 generatePlan 导出';
        },
      },
      {
        label: 'Agent 支持两阶段模式',
        validate: (ctx) => {
          const c = ctx.fileContents.get('core/agent.ts') || '';
          return c.includes('runAgent') && c.includes('plan')
            ? true : '缺少 runAgent 或 plan 关键字';
        },
      },
    ],
  },
  {
    name: '工具箱系统 (Toolbox System)',
    description: '工具按用途分组，支持 Phase 1 筛选',
    expectedFiles: ['toolboxes.ts'],
    checks: [
      {
        label: 'Toolbox 定义完整',
        validate: (ctx) => {
          const c = ctx.fileContents.get('toolboxes.ts') || '';
          return c.includes('Toolbox') && c.includes('export')
            ? true : '缺少 Toolbox 定义';
        },
      },
    ],
  },
  {
    name: '技能系统 (Skill System)',
    description: '可插拔、模块化扩展',
    expectedFiles: ['core/skill-registry.ts', 'core/skill-loader.ts'],
    checks: [
      {
        label: '技能注册表存在',
        validate: (ctx) => ctx.fileContents.has('core/skill-registry.ts')
          ? true : '缺少 skill-registry.ts',
      },
      {
        label: '技能加载器存在',
        validate: (ctx) => ctx.fileContents.has('core/skill-loader.ts')
          ? true : '缺少 skill-loader.ts',
      },
    ],
  },
  {
    name: '安全沙箱 (Sandbox)',
    description: '路径验证 + 权限分级',
    expectedFiles: ['security/sandbox.ts'],
    checks: [
      {
        label: '沙箱模块存在',
        validate: (ctx) => ctx.fileContents.has('security/sandbox.ts')
          ? true : '缺少 sandbox.ts',
      },
      {
        label: '路径验证逻辑完整',
        validate: (ctx) => {
          const c = ctx.fileContents.get('security/sandbox.ts') || '';
          return c.includes('resolveSandboxPath') || c.includes('isPathAllowed')
            ? true : '缺少路径验证函数';
        },
      },
    ],
  },
  {
    name: '性能监控 (Monitor)',
    description: '工具调用统计',
    expectedFiles: ['core/monitor.ts'],
    checks: [
      {
        label: '监控模块存在',
        validate: (ctx) => ctx.fileContents.has('core/monitor.ts')
          ? true : '缺少 monitor.ts',
      },
    ],
  },
  {
    name: '循环检测 (Loop Detection)',
    description: '防止死循环',
    expectedFiles: ['core/loop-detector.ts'],
    checks: [
      {
        label: '循环检测器存在',
        validate: (ctx) => ctx.fileContents.has('core/loop-detector.ts')
          ? true : '缺少 loop-detector.ts',
      },
    ],
  },
  {
    name: '配置系统 (Config)',
    description: '双端适配 + 预设',
    expectedFiles: ['core/config.ts'],
    checks: [
      {
        label: '配置模块存在',
        validate: (ctx) => ctx.fileContents.has('core/config.ts')
          ? true : '缺少 config.ts',
      },
    ],
  },
  {
    name: '测试覆盖 (Test Coverage)',
    description: '查漏补缺',
    expectedFiles: ['tests/test.ts'],
    checks: [
      {
        label: '测试文件存在',
        validate: (ctx) => ctx.fileContents.has('tests/test.ts')
          ? true : '缺少 tests/test.ts',
      },
    ],
  },
];

// ============================================================================
// 辅助函数
// ============================================================================

function countTotalLines(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {
        total += countTotalLines(fp);
      } else if (entry.name.endsWith('.ts')) {
        try { total += fs.readFileSync(fp, 'utf-8').split('\n').length; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return total;
}

function countExports(content: string): number {
  const m = content.match(/export\s+(default\s+|const\s+|function\s+|class\s+|interface\s+|type\s+)/g);
  return m ? m.length : 0;
}

function countImports(content: string): number {
  const m = content.match(/^import\s+/gm);
  return m ? m.length : 0;
}

function estimateComplexity(content: string): number {
  const lines = content.split('\n').filter(
    (l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')
  );
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

function hasCorrespondingTest(srcPath: string, testDir: string): boolean {
  const baseName = path.basename(srcPath, '.ts');
  const testFile = path.join(testDir, baseName + '.test.ts');
  if (fs.existsSync(testFile)) return true;
  try {
    const tc = fs.readFileSync(path.join(testDir, 'test.ts'), 'utf-8');
    return tc.includes(baseName) || tc.includes(srcPath);
  } catch {
    return false;
  }
}

function detectIssues(content: string): string[] {
  const issues: string[] = [];
  if (/catch\s*\(\s*\)\s*\{\s*\}/.test(content)) {
    issues.push('存在空 catch 块（吞异常）');
  }
  const anyCount = (content.match(/:\s*any\b/g) || []).length;
  if (anyCount > 5) issues.push('any 类型使用过多 (' + anyCount + ' 处)');

  const lines = content.split('\n');
  let inFn = false, fnStart = 0, bc = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(async\s+)?function\s+\w+|^\s*\w+\s*=\s*(async\s+)?\(/.test(line)) {
      inFn = true; fnStart = i; bc = 0;
    }
    if (inFn) {
      bc += (line.match(/\{/g) || []).length;
      bc -= (line.match(/\}/g) || []).length;
      if (bc <= 0 && i > fnStart) {
        if (i - fnStart > 50) issues.push('超长函数 (' + (i - fnStart + 1) + ' 行)');
        inFn = false;
      }
    }
  }

  const clc = (content.match(/console\.(log|warn|error)/g) || []).length;
  if (clc > 10) issues.push('console 调用过多 (' + clc + ' 处)');
  return issues;
}

function getVersion(projectRoot: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 执行项目自检
 *
 * Phase 5.2 新增参数：
 * - errorLogPath: 可选，运行时错误日志目录路径。如果提供，会注入运行时错误数据，
 *   优先级高于静态分析结果。
 *
 * @param srcDir 项目 src/ 目录路径
 * @param errorLogPath 可选，运行时错误日志目录（默认：项目根目录/errors）
 * @returns 自检报告
 */
export async function inspectSelf(
  srcDir: string,
  errorLogPath?: string
): Promise<InspectionReport> {
  const projectRoot = path.resolve(srcDir, '..');
  const testDir = path.join(projectRoot, 'tests');

  // Step 1: 动态扫描所有 .ts 文件
  const allFiles = scanTsFiles(srcDir);
  const fileContents = new Map<string, string>();
  for (const file of allFiles) {
    const fp = path.join(srcDir, file);
    try { fileContents.set(file, fs.readFileSync(fp, 'utf-8')); }
    catch { fileContents.set(file, ''); }
  }

  const checkCtx: CheckContext = { srcDir, fileContents, allFiles };

  // Step 2: 代码质量指标
  const tsFileCount = allFiles.length;
  const totalLines = countTotalLines(srcDir);
  let totalExports = 0, totalImports = 0;
  for (const [, c] of fileContents) {
    totalExports += countExports(c);
    totalImports += countImports(c);
  }

  let modulesWithTests = 0;
  for (const file of allFiles) {
    if (hasCorrespondingTest(file, testDir)) modulesWithTests++;
  }
  const testCoverage = allFiles.length > 0
    ? Math.round((modulesWithTests / allFiles.length) * 100) : 0;

  const typesContent = fileContents.get('core/types.ts') || fileContents.get('types/index.ts') || '';
  const interfaceCount = (typesContent.match(/interface\s+\w+/g) || []).length;
  const typeAliasCount = (typesContent.match(/type\s+\w+/g) || []).length;

  const qualityMetrics: CodeQualityMetric[] = [
    { name: 'TypeScript 文件数', value: tsFileCount, passed: tsFileCount > 5 },
    { name: '总代码行数', value: totalLines, passed: totalLines > 100, note: tsFileCount + ' 个 .ts 文件' },
    { name: '测试覆盖率', value: testCoverage + '%', target: '100%', passed: testCoverage >= 80, note: modulesWithTests + '/' + allFiles.length + ' 个模块有测试' },
    { name: '类型定义数', value: interfaceCount + ' interfaces + ' + typeAliasCount + ' types', passed: interfaceCount > 10, note: '类型定义越多，类型越安全' },
    { name: '导出函数数', value: totalExports, passed: totalExports > 20, note: '导出越多，模块化程度越高' },
    { name: '导入语句数', value: totalImports, passed: totalImports > 20, note: '导入越多，模块间耦合越高' },
  ];

  // Step 3: 模块分析
  const moduleAnalysis: ModuleAnalysis[] = [];
  for (const file of allFiles) {
    const content = fileContents.get(file) || '';
    const loc = content.split('\n').length;
    moduleAnalysis.push({
      path: file,
      linesOfCode: loc,
      hasTests: hasCorrespondingTest(file, testDir),
      exportsCount: countExports(content),
      importsCount: countImports(content),
      complexityScore: estimateComplexity(content),
      issues: detectIssues(content),
    });
  }

  // Step 4: 架构合规检查
  const architectureChecks: ArchitectureCheck[] = [];
  for (const check of ARCHITECTURE_CHECKS) {
    for (const subCheck of check.checks) {
      const result = subCheck.validate(checkCtx);
      const passed = typeof result === 'boolean' ? result : false;
      architectureChecks.push({
        name: check.name + ' - ' + subCheck.label,
        passed,
        details: check.description,
        recommendation: passed ? undefined : (typeof result === 'string' ? result : '需要实现: ' + subCheck.label),
      });
    }
  }

  // Step 5: 使用痛点（静态分析）
  const painPoints: InspectionReport['painPoints'] = [];
  for (const m of moduleAnalysis) {
    for (const issue of m.issues) {
      painPoints.push({
        description: m.path + ': ' + issue,
        severity: issue.includes('any 类型') || issue.includes('空 catch') ? 'medium' : 'low',
        evidence: '静态分析得出',
      });
    }
  }
  const untestedModules = moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
  for (const m of untestedModules) {
    painPoints.push({
      description: m.path + ' 没有对应测试 (' + m.linesOfCode + ' 行)',
      severity: 'high',
      evidence: '文件存在但无测试覆盖',
    });
  }
  const complexModules = moduleAnalysis.filter((m) => m.complexityScore >= 7);
  for (const m of complexModules) {
    painPoints.push({
      description: m.path + ' 复杂度过高 (评分: ' + m.complexityScore + '/10)',
      severity: 'medium',
      evidence: '控制流密度分析',
    });
  }

  // Step 6: 优化建议
  const suggestions: string[] = [];
  if (testCoverage < 80) suggestions.push('提高测试覆盖率到 80%+（当前 ' + testCoverage + '%）');
  if (complexModules.length > 0) suggestions.push('重构 ' + complexModules.length + ' 个高复杂度模块');
  if (untestedModules.length > 0) suggestions.push('为 ' + untestedModules.length + ' 个未测试模块添加测试');
  suggestions.push('实现循环错误自动修复机制');
  suggestions.push('增加端到端测试验证完整流程');
  suggestions.push('增加工具调用的路径追踪');

  // Step 7: 总结
  const passedChecks = architectureChecks.filter((c) => c.passed).length;
  const totalChecks = architectureChecks.length;
  const healthScore = Math.round((passedChecks / Math.max(totalChecks, 1)) * 100);

  let summary = '';
  if (healthScore >= 90) {
    summary = '架构通过率 ' + healthScore + '%，系统健康。建议：' + suggestions.slice(0, 2).join('；') + '。';
  } else if (healthScore >= 70) {
    summary = '架构通过率 ' + healthScore + '%，系统基本正常。优先处理：' + suggestions.slice(0, 3).join('；') + '。';
  } else {
    summary = '架构通过率 ' + healthScore + '%，系统存在缺陷。重点关注：' + suggestions.slice(0, 3).join('；') + '。';
  }

  const report: InspectionReport = {
    timestamp: new Date().toISOString(),
    version: getVersion(projectRoot),
    qualityMetrics,
    moduleAnalysis,
    architectureChecks,
    painPoints,
    suggestions,
    summary,
  };

  // Phase 5.2: 注入运行时错误数据（优先级 > 静态分析）
  if (errorLogPath !== undefined) {
    try {
      const errorAnalysis = await analyzeErrors(errorLogPath);
      if (errorAnalysis.totalErrors > 0) {
        injectErrorsIntoInspection(report, errorAnalysis);
      }
    } catch (err) {
      // 错误分析失败不影响静态检查报告
      console.warn('[inspector] 运行时错误分析失败:', err);
    }
  }

  return report;
}
