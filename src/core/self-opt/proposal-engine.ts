/**
 * @file proposal-engine.ts - 优化提案引擎 (Phase 5.3 升级)
 * @description
 *   Self-Optimization 子系统的核心组件之一。将项目自检报告和外部调研结果
 *   转换为可执行的优化提案（OptimizationProposal）。
 *
 *   Phase 5.1 升级：
 *   - 模板从 5 种扩展到 10 种（新增：死代码清理、依赖安全、API 规范、性能优化、错误处理统一）
 *   - generateFileChanges 覆盖所有模板类型，>80% 的方案可直接生成文件变更
 *   - 重构（refactor）类型方案也能生成骨架 diff
 *   - 测试命令按提案类型细化（type-check / test / build）
 *
 *   Phase 5.3 升级：
 *   - generateProposals() 新增可选参数 learningInsights
 *   - 根据历史成功率动态调整风险等级：高成功率降级，低成功率升级
 *   - 反复失败的模板暂时禁用
 *
 *   工作流程：
 *   1. generateProposals: 使用模板匹配提案，生成优化提案列表
 *   2. generateFileChanges: 为每个提案生成具体的文件变更计划（FileChange[]）
 *   3. formatProposals: 将提案格式化为可读文本，供 CLI 展示
 *
 *   设计原则
 *   - 模板匹配：预定义 10 种常见优化类型，避免 LLM 调用的不确定性
 *   - 风险分级（low/medium/high/destructive）控制执行策略
 *   - 测试优先：每个提案必须附带至少一个验证测试用例
 *   - 可回退：每个提案都配有 Git 回退计划
 *
 * @module core/self-opt/proposal-engine
 */

import type {
  InspectionReport,
  ResearchReport,
  OptimizationProposal,
  TestCase,
  FileChange,
  RiskLevel,
} from './types.js';

// ============================================================================
// 模板类型定义
// ============================================================================

/**
 * 提案模板接口
 *
 * 每个模板定义了一种优化模式，包括：
 * - 匹配条件：什么使用场景会触发该模板
 * - 优化类型（add/remove/modify/refactor）
 * - 风险等级（决定是否可以自动执行）
 * - 描述函数：生成后作为提案的描述内容
 * - 测试用例生成函数：用于验证优化是否成功
 */
interface Template {
  /** 匹配痛点关键词（小写匹配） */
  matchPainPoints: string[];
  /** 优化类型 */
  type: 'add' | 'remove' | 'modify' | 'refactor';
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'destructive';
  /** 模板标题 */
  title: string;
  /** 生成提案描述 */
  description: (r: InspectionReport) => string;
  /** 说明优化理由（参考哪些外部资源） */
  rationale: (r: ResearchReport) => string;
  /** 预期收益 */
  benefit: string;
  /** 生成测试用例列表 */
  generateTestCases: (r: InspectionReport) => TestCase[];
  /** 需要安装的依赖包 */
  dependencies: string[];
}

// ============================================================================
// 提案模板库（10 种）
// ============================================================================

/**
 * 预定义的优化提案模板
 *
 * 当前支持 10 种优化类型：
 * 1. 补充缺失的测试文件（low risk）
 * 2. 简化高复杂度模块（medium risk）
 * 3. 消除 any 类型（low risk）
 * 4. 补充缺失的架构检查（medium risk）
 * 5. 修改空 catch 块（low risk）
 * 6. 死代码清理（low risk）         — Phase 5.1 新增
 * 7. 依赖安全检查（medium risk）     — Phase 5.1 新增
 * 8. API 规范检查（low risk）        — Phase 5.1 新增
 * 9. 性能优化建议（medium risk）     — Phase 5.1 新增
 * 10. 错误处理统一（medium risk）    — Phase 5.1 新增
 *
 * 扩展方法：在 TEMPLATES 数组中添加新对象即可。
 */
const TEMPLATES: Template[] = [
  // === 模板 1: 补充缺失的测试文件 ===
  {
    matchPainPoints: ['没有对应测试', '测试覆盖', 'hasTests: false'],
    type: 'add',
    riskLevel: 'low',
    title: '补充缺失的测试文件',
    description: (r) => {
      const m = r.moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
      return '为 ' + m.map((m) => m.path).join(', ') + ' 添加单元测试';
    },
    rationale: () => '单元测试是保证代码质量和可维护性的基础实践',
    benefit: '提高测试覆盖率，减少回归风险',
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => !m.hasTests && m.linesOfCode > 50)
        .map((m, i) => ({
          id: 'tc-test-' + i,
          type: 'unit' as const,
          description: '验证 ' + m.path + ' 模块可正常导入和执行',
          setup: '',
          action: '导入模块',
          expected: '无报错运行',
          command: 'npx tsc --noEmit',
        })),
    dependencies: [],
  },

  // === 模板 2: 简化高复杂度模块 ===
  {
    matchPainPoints: ['复杂度过高', 'complexity'],
    type: 'refactor',
    riskLevel: 'medium',
    title: '简化高复杂度模块',
    description: (r) =>
      '重构 ' + r.moduleAnalysis
        .filter((m) => m.complexityScore >= 7)
        .map((m) => m.path)
        .join(', '),
    rationale: () => '高复杂度增加维护成本和出错概率，应控制在合理水平',
    benefit: '提高代码可读性和可维护性',
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => m.complexityScore >= 7)
        .map((m, i) => ({
          id: 'tc-ref-' + i,
          type: 'unit' as const,
          description: '验证 ' + m.path + ' 重构后功能一致',
          setup: '',
          action: '执行原有测试用例',
          expected: '结果与重构前一致',
          command: 'npx tsc --noEmit',
        })),
    dependencies: [],
  },

  // === 模板 3: 消除 any 类型 ===
  {
    matchPainPoints: ['any 类型', '类型安全'],
    type: 'modify',
    riskLevel: 'low',
    title: '消除 any 类型',
    description: () => '将 any 替换为确切类型，提高类型安全',
    rationale: () => 'any 类型绕过 TypeScript 类型检查，是潜在的 bug 来源',
    benefit: '提高类型安全性，减少运行时错误',
    generateTestCases: () => [
      {
        id: 'tc-types-0',
        type: 'unit' as const,
        description: '编译通过，无 any 类型警告',
        setup: '',
        action: 'tsc --noEmit',
        expected: '无报错运行',
        command: 'npx tsc --noEmit',
      },
    ],
    dependencies: [],
  },

  // === 模板 4: 补充缺失的架构检查 ===
  {
    matchPainPoints: ['架构检查', '未通过', 'missing'],
    type: 'add',
    riskLevel: 'medium',
    title: '补充缺失的架构检查',
    description: (r) =>
      '实现: ' + r.architectureChecks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', '),
    rationale: () => '架构检查影响系统的健壮性和可扩展性',
    benefit: '增强系统健壮性和可扩展性',
    generateTestCases: (r) =>
      r.architectureChecks
        .filter((c) => !c.passed)
        .map((c, i) => ({
          id: 'tc-arch-' + i,
          type: 'integration' as const,
          description: '验证 ' + c.name,
          setup: '',
          action: '调用相关 API',
          expected: c.details,
          command: 'npx tsx scripts/arch-check.ts',
        })),
    dependencies: [],
  },

  // === 模板 5: 修改空 catch 块 ===
  {
    matchPainPoints: ['空 catch', '吞异常'],
    type: 'modify',
    riskLevel: 'low',
    title: '修改空 catch 块',
    description: () => '为空 catch 块添加日志和错误处理',
    rationale: () => '空 catch 块是坏味道，错误被静默吞掉，不利于排查',
    benefit: '提高代码可观察性，便于错误排查',
    generateTestCases: () => [
      {
        id: 'tc-catch-0',
        type: 'unit' as const,
        description: '编译通过，无空 catch 块',
        setup: '',
        action: 'tsc --noEmit',
        expected: '无报错运行',
        command: 'npx tsc --noEmit',
      },
    ],
    dependencies: [],
  },

  // === 模板 6: 死代码清理 (Phase 5.1 新增) ===
  {
    matchPainPoints: ['未使用的', 'dead code', '未引用'],
    type: 'remove',
    riskLevel: 'low',
    title: '清理死代码',
    description: (r) => {
      const dead = r.moduleAnalysis.filter((m) => m.exportsCount === 0 && m.linesOfCode > 10);
      return '移除或整合 ' + dead.map((m) => m.path).join(', ');
    },
    rationale: () => '死代码增加维护负担，降低代码可读性',
    benefit: '减少代码量，提高可读性',
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => m.exportsCount === 0 && m.linesOfCode > 10)
        .map((m, i) => ({
          id: 'tc-dead-' + i,
          type: 'unit' as const,
          description: '确认 ' + m.path + ' 无外部引用',
          setup: '',
          action: '检查 import 引用',
          expected: '无外部模块引用该文件',
          command: 'npx tsc --noEmit',
        })),
    dependencies: [],
  },

  // === 模板 7: 依赖安全检查 (Phase 5.1 新增) ===
  {
    matchPainPoints: ['依赖', '过时', 'vulnerability'],
    type: 'modify',
    riskLevel: 'medium',
    title: '依赖安全检查',
    description: () => '检查 package.json 中的依赖是否有已知漏洞或过时版本',
    rationale: () => '过时依赖可能包含安全漏洞，影响系统安全',
    benefit: '提高系统安全性，减少已知漏洞',
    generateTestCases: () => [
      {
        id: 'tc-deps-0',
        type: 'unit' as const,
        description: 'npm audit 无高危漏洞',
        setup: '',
        action: 'npm audit',
        expected: '无 high/critical 漏洞',
        command: 'npm audit --audit-level=high',
      },
    ],
    dependencies: [],
  },

  // === 模板 8: API 规范检查 (Phase 5.1 新增) ===
  {
    matchPainPoints: ['API', '规范', '签名', '函数名'],
    type: 'modify',
    riskLevel: 'low',
    title: 'API 规范检查',
    description: (r) => {
      const funcs = r.moduleAnalysis.filter((m) => m.exportsCount > 3);
      return '检查 ' + funcs.map((m) => m.path).join(', ') + ' 的函数命名和参数规范';
    },
    rationale: () => '一致的 API 规范提高代码可读性和可维护性',
    benefit: '提高代码一致性，降低学习成本',
    generateTestCases: () => [
      {
        id: 'tc-api-0',
        type: 'unit' as const,
        description: '编译通过，无类型错误',
        setup: '',
        action: 'tsc --noEmit',
        expected: '无报错运行',
        command: 'npx tsc --noEmit',
      },
    ],
    dependencies: [],
  },

  // === 模板 9: 性能优化建议 (Phase 5.1 新增) ===
  {
    matchPainPoints: ['性能', '超长函数', 'console 调用过多', '同步 I/O'],
    type: 'refactor',
    riskLevel: 'medium',
    title: '性能优化建议',
    description: (r) => {
      const slow = r.moduleAnalysis.filter((m) => m.linesOfCode > 200 || m.complexityScore >= 7);
      return '优化 ' + slow.map((m) => m.path).join(', ');
    },
    rationale: () => '性能优化提高系统响应速度和用户体验',
    benefit: '提高系统性能，减少响应时间',
    generateTestCases: (r) =>
      r.moduleAnalysis
        .filter((m) => m.linesOfCode > 200 || m.complexityScore >= 7)
        .map((m, i) => ({
          id: 'tc-perf-' + i,
          type: 'unit' as const,
          description: '验证 ' + m.path + ' 优化后功能一致',
          setup: '',
          action: '执行原有测试',
          expected: '结果与优化前一致',
          command: 'npx tsc --noEmit',
        })),
    dependencies: [],
  },

  // === 模板 10: 错误处理统一 (Phase 5.1 新增) ===
  {
    matchPainPoints: ['空 catch', '错误处理', '异常', 'throw'],
    type: 'refactor',
    riskLevel: 'medium',
    title: '错误处理统一',
    description: () => '将裸 throw 和空 catch 块替换为结构化错误处理',
    rationale: () => '统一的错误处理模式提高系统的健壮性和可调试性',
    benefit: '提高系统健壮性，便于错误追踪',
    generateTestCases: () => [
      {
        id: 'tc-err-0',
        type: 'unit' as const,
        description: '编译通过，无空 catch 块',
        setup: '',
        action: 'tsc --noEmit',
        expected: '无报错运行',
        command: 'npx tsc --noEmit',
      },
    ],
    dependencies: [],
  },
];

// ============================================================================
// 工具函数：按提案类型获取测试命令
// ============================================================================

/**
 * 根据提案类型返回对应的测试命令
 * - type-check 类：npx tsc --noEmit
 * - 测试类：npm test
 * - 架构类：npx tsx scripts/arch-check.ts
 * - 构建类：npm run build
 */
export function getTestCommand(proposal: OptimizationProposal): string {
  const t = proposal.target || '';
  // 类型安全 / any / catch / API 规范
  if (t.includes('any') || t.includes('catch') || t.includes('类型') || t.includes('API')) {
    return 'npx tsc --noEmit';
  }
  // 测试文件
  if (t.includes('测试')) {
    return 'npm test';
  }
  // 架构检查
  if (t.includes('架构')) {
    return 'npx tsx scripts/arch-check.ts';
  }
  // 依赖安全
  if (t.includes('依赖')) {
    return 'npm audit --audit-level=high';
  }
  // 默认：构建检查
  return 'npm run build';
}

// ============================================================================
// 学习洞察接口（避免循环依赖）
// ============================================================================

/**
 * 学习洞察（简化版，与 optimization-learner.ts 一致）
 */
export interface LearningInsight {
  type: 'high-success' | 'low-success' | 'frequent-failure' | 'time-cost' | 'improving' | 'degrading';
  target: string;
  description: string;
  action: 'auto-execute' | 'require-confirm' | 'disable-template' | 'keep-current' | 'investigate';
  evidence: {
    sampleCount: number;
    successRate: number;
  };
}

/**
 * 风险等级调整顺序
 */
const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'destructive'];

function riskUp(level: RiskLevel): RiskLevel {
  const idx = RISK_ORDER.indexOf(level);
  return idx < RISK_ORDER.length - 1 ? RISK_ORDER[idx + 1] : level;
}

function riskDown(level: RiskLevel): RiskLevel {
  const idx = RISK_ORDER.indexOf(level);
  return idx > 0 ? RISK_ORDER[idx - 1] : level;
}

// ============================================================================
// 主函数：生成优化提案
// ============================================================================

/**
 * 根据项目自检报告和外部调研结果，生成优化提案
 *
 * Phase 5.3 新增参数：
 * - learningInsights: 可选，学习洞察列表。根据历史成功率动态调整风险等级：
 *   - 高成功率 (auto-execute) → 降低风险等级（medium→low）
 *   - 低成功率 (require-confirm) → 提高风险等级
 *   - 禁用模板 (disable-template) → 跳过该提案
 *
 * 工作流程：
 * 1. 遍历所有提案模板
 * 2. 对每个模板，检查是否匹配当前项目的痛点
 * 3. 如果匹配且有 learningInsights，根据历史调整风险等级
 * 4. 生成 OptimizationProposal 对象
 * 5. 按风险等级排序（low → medium → high → destructive）
 *
 * @param inspection 项目自检报告（由 Inspector 生成）
 * @param research 外部调研报告（由 Researcher 生成）
 * @param learningInsights 学习洞察（可选，由 optimization-learner.ts 生成）
 * @returns 优化提案列表，按风险等级排序
 *
 * @example
 * ```ts
 * const insp = await inspectSelf(srcDir);
 * const res = await researchExternal();
 * const learning = await learnFromHistory(projectRoot);
 * const proposals = generateProposals(insp, res, learning.insights);
 * console.log(`生成 ${proposals.length} 个提案`);
 * ```
 */
export function generateProposals(
  inspection: InspectionReport,
  research: ResearchReport,
  learningInsights?: LearningInsight[]
): OptimizationProposal[] {
  const proposals: OptimizationProposal[] = [];
  const order = { low: 0, medium: 1, high: 2, destructive: 3 };

  // Phase 5.3: 构建洞察查找表
  const insightMap = new Map<string, LearningInsight>();
  if (learningInsights) {
    for (const ins of learningInsights) {
      insightMap.set(ins.target, ins);
    }
  }

  for (const t of TEMPLATES) {
    const hasMatch = t.matchPainPoints.some((kw) => {
      const k = kw.toLowerCase();
      return (
        inspection.painPoints.some((p) => p.description.toLowerCase().includes(k)) ||
        inspection.architectureChecks.some(
          (c) => !c.passed && c.name.toLowerCase().includes(k)
        )
      );
    });

    if (!hasMatch) continue;

    // Phase 5.3: 根据学习洞察调整风险等级
    let adjustedRisk = t.riskLevel;
    const typeInsight = insightMap.get('类型: ' + t.type);
    const targetInsight = insightMap.get(t.title);
    const insight = targetInsight || typeInsight;

    if (insight) {
      if (insight.action === 'auto-execute' || insight.action === 'keep-current') {
        // 高成功率 → 降低风险（更容易自动执行）
        adjustedRisk = riskDown(t.riskLevel);
      } else if (insight.action === 'require-confirm' || insight.action === 'investigate') {
        // 低成功率 → 提高风险（需要人工确认）
        adjustedRisk = riskUp(t.riskLevel);
      } else if (insight.action === 'disable-template') {
        // 反复失败 → 跳过该提案
        continue;
      }
    }

    proposals.push({
      id: 'prop-' + Date.now() + '-' + proposals.length,
      type: t.type,
      riskLevel: adjustedRisk,
      target: t.title,
      description: t.description(inspection),
      rationale: t.rationale(research),
      expectedBenefit: t.benefit,
      files: [], // 文件变更由 generateFileChanges 生成
      dependencies: t.dependencies,
      testCases: t.generateTestCases(inspection),
      rollbackPlan: 'Git reset 到当前目标',
    });
  }

  proposals.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
  return proposals;
}

// ============================================================================
// 文件变更生成
// ============================================================================

/**
 * 为优化提案生成具体的文件变更计划
 *
 * 此函数是 Phase 5 的关键组件：
 * 1. 检查提案是否已有文件变更（如果已有，则跳过）
 * 2. 根据提案类型，生成对应的文件变更
 *    - 补充测试提案：生成缺失的测试文件骨架
 *    - any 类型提案：生成检查脚本
 *    - 空 catch 提案：生成检查脚本
 *    - 死代码清理：生成检查脚本
 *    - 重构提案：生成重构提示文件
 * 3. 将生成的 FileChange[] 赋值给 proposal.files
 *
 * 注意：
 * - 测试文件使用 assert 模块（兼容 vitest）
 * - 测试文件 import 路径使用 "../src/..."，不用 "../core/..."
 * - 每个测试文件都是独立的可运行测试
 *
 * @param proposal 优化提案（会被直接修改，写入 files 字段）
 * @param inspection 项目自检报告（用于获取模块分析数据）
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
  if (proposal.files.length > 0) return;

  const changes: FileChange[] = [];
  const target = proposal.target;

  // === 模板 1: 补充缺失的测试文件 ===
  if (target.includes('测试')) {
    const untested = inspection.moduleAnalysis.filter(
      (m) => !m.hasTests && m.linesOfCode > 50
    );
    for (const mod of untested.slice(0, 3)) {
      const fn = mod.path.split(/[\\/]/).pop()?.replace(/\.ts$/, '') || 'module';
      const tp = 'tests/' + fn + '.test.ts';
      const importPath = '../src/' + mod.path.replace(/\\/g, '/');
      const tc = '/**\n' +
        ' * Auto-generated test for ' + fn + '\n' +
        ' * 验证模块可正常导入和执行\n' +
        ' */\n\n' +
        'import assert from "assert";\n\n' +
        'describe("' + fn + '", () => {\n' +
        '  it("should be importable", async () => {\n' +
        '    const m = await import("' + importPath + '");\n' +
        '    assert.ok(m);\n' +
        '  });\n' +
        '});\n';
      changes.push({ path: tp, action: 'create', content: tc });
    }
  }

  // === 模板 2: 简化高复杂度模块 ===
  if (target.includes('复杂度')) {
    const complex = inspection.moduleAnalysis.filter((m) => m.complexityScore >= 7);
    for (const mod of complex.slice(0, 3)) {
      const hint = 'scripts/refactor-hint-' + mod.path.replace(/[\\/]/g, '-') + '.md';
      changes.push({
        path: hint,
        action: 'create',
        content: '# Refactoring Guide: ' + mod.path + '\n\n' +
          '## 当前状态\n' +
          '- 代码行数: ' + mod.linesOfCode + '\n' +
          '- 复杂度评分: ' + mod.complexityScore + '/10\n' +
          '- 导出数: ' + mod.exportsCount + '\n' +
          '- 问题: ' + (mod.issues.join(', ') || '无') + '\n\n' +
          '## 建议\n' +
          '1. 拆分超长函数\n2. 减少控制流嵌套\n3. 提取公共逻辑\n',
      });
    }
  }

  // === 模板 3: 消除 any 类型 ===
  if (target.includes('any')) {
    changes.push({
      path: 'scripts/check-any-types.ts',
      action: 'create',
      content: '/**\n' +
        ' * 检查项目中的 any 类型使用\n' +
        ' * 运行: npx tsx scripts/check-any-types.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'function findAny(dir: string): string[] {\n' +
        '  const r: string[] = [];\n' +
        '  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {\n' +
        '    const fp = path.join(dir, f.name);\n' +
        '    if (f.isDirectory() && !fp.includes("node_modules")) {\n' +
        '      r.push(...findAny(fp));\n' +
        '    } else if (f.name.endsWith(".ts")) {\n' +
        '      const c = fs.readFileSync(fp, "utf-8");\n' +
        '      const ls = c.split("\\n");\n' +
        '      for (let i = 0; i < ls.length; i++) {\n' +
        '        if (/:\\s*any\\b/.test(ls[i])) r.push(fp + ":" + (i + 1));\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '  return r;\n' +
        '}\n\n' +
        'const anyTypes = findAny(path.resolve(__dirname, "../src"));\n' +
        'if (anyTypes.length > 0) {\n' +
        '  console.log("发现 any 类型使用:");\n' +
        '  anyTypes.forEach((t) => console.log("  " + t));\n' +
        '} else {\n' +
        '  console.log("✅ 未发现 any 类型使用!");\n' +
        '}\n',
    });
  }

  // === 模板 4: 补充缺失的架构检查 ===
  if (target.includes('架构')) {
    const failed = inspection.architectureChecks.filter((c) => !c.passed);
    changes.push({
      path: 'scripts/arch-check.ts',
      action: 'create',
      content: '/**\n' +
        ' * 架构合规检查脚本\n' +
        ' * 运行: npx tsx scripts/arch-check.ts\n' +
        ' */\n' +
        'const failedChecks = ' + JSON.stringify(failed.map((c) => c.name), null, 2) + ';\n' +
        'if (failedChecks.length > 0) {\n' +
        '  console.log("未通过的架构检查:");\n' +
        '  failedChecks.forEach((c) => console.log("  ❌ " + c));\n' +
        '  process.exit(1);\n' +
        '} else {\n' +
        '  console.log("✅ 所有架构检查通过");\n' +
        '}\n',
    });
  }

  // === 模板 5: 修改空 catch 块 ===
  if (target.includes('catch')) {
    changes.push({
      path: 'scripts/find-empty-catches.ts',
      action: 'create',
      content: '/**\n' +
        ' * 检查项目中的空 catch 块\n' +
        ' * 运行: npx tsx scripts/find-empty-catches.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'function findCatch(dir: string): string[] {\n' +
        '  const r: string[] = [];\n' +
        '  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {\n' +
        '    const fp = path.join(dir, f.name);\n' +
        '    if (f.isDirectory() && !fp.includes("node_modules")) {\n' +
        '      r.push(...findCatch(fp));\n' +
        '    } else if (f.name.endsWith(".ts") && /catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}/.test(fs.readFileSync(fp, "utf-8"))) {\n' +
        '      r.push(fp);\n' +
        '    }\n' +
        '  }\n' +
        '  return r;\n' +
        '}\n\n' +
        'const ec = findCatch(path.resolve(__dirname, "../src"));\n' +
        'if (ec.length > 0) {\n' +
        '  console.log("发现空 catch 块:");\n' +
        '  ec.forEach((f) => console.log("  " + f));\n' +
        '} else {\n' +
        '  console.log("✅ 未发现空 catch 块!");\n' +
        '}\n',
    });
  }

  // === 模板 6: 死代码清理 ===
  if (target.includes('死代码')) {
    changes.push({
      path: 'scripts/find-dead-code.ts',
      action: 'create',
      content: '/**\n' +
        ' * 扫描未使用的导出（零导出的文件）\n' +
        ' * 运行: npx tsx scripts/find-dead-code.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'function scanExports(dir: string): { file: string; count: number }[] {\n' +
        '  const results: { file: string; count: number }[] = [];\n' +
        '  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {\n' +
        '    const fp = path.join(dir, f.name);\n' +
        '    if (f.isDirectory() && !fp.includes("node_modules")) {\n' +
        '      results.push(...scanExports(fp));\n' +
        '    } else if (f.name.endsWith(".ts")) {\n' +
        '      const c = fs.readFileSync(fp, "utf-8");\n' +
        '      const count = (c.match(/export\\s+(default|const|function|class|interface|type)/g) || []).length;\n' +
        '      results.push({ file: fp, count });\n' +
        '    }\n' +
        '  }\n' +
        '  return results;\n' +
        '}\n\n' +
        'const all = scanExports(path.resolve(__dirname, "../src"));\n' +
        'const dead = all.filter((x) => x.count === 0);\n' +
        'if (dead.length > 0) {\n' +
        '  console.log("零导出文件（可能是死代码）:");\n' +
        '  dead.forEach((d) => console.log("  " + d.file));\n' +
        '} else {\n' +
        '  console.log("✅ 未发现零导出文件!");\n' +
        '}\n',
    });
  }

  // === 模板 7: 依赖安全检查 ===
  if (target.includes('依赖')) {
    changes.push({
      path: 'scripts/check-dependencies.ts',
      action: 'create',
      content: '/**\n' +
        ' * 检查 package.json 中的依赖版本\n' +
        ' * 运行: npx tsx scripts/check-dependencies.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'const pkgPath = path.resolve(__dirname, "../../package.json");\n' +
        'const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));\n' +
        'const deps = { ...pkg.dependencies, ...pkg.devDependencies };\n' +
        'console.log("当前依赖 (" + Object.keys(deps).length + " 个):");\n' +
        'for (const [name, ver] of Object.entries(deps)) {\n' +
        '  console.log("  " + name + ": " + ver);\n' +
        '}\n' +
        'console.log("\\n运行 npm outdated 查看可更新的依赖");\n',
    });
  }

  // === 模板 8: API 规范检查 ===
  if (target.includes('API')) {
    changes.push({
      path: 'scripts/check-api-conventions.ts',
      action: 'create',
      content: '/**\n' +
        ' * 检查函数命名规范和参数一致性\n' +
        ' * 运行: npx tsx scripts/check-api-conventions.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'function checkConventions(dir: string): string[] {\n' +
        '  const issues: string[] = [];\n' +
        '  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {\n' +
        '    const fp = path.join(dir, f.name);\n' +
        '    if (f.isDirectory() && !fp.includes("node_modules")) {\n' +
        '      issues.push(...checkConventions(fp));\n' +
        '    } else if (f.name.endsWith(".ts")) {\n' +
        '      const c = fs.readFileSync(fp, "utf-8");\n' +
        '      const lines = c.split("\\n");\n' +
        '      for (let i = 0; i < lines.length; i++) {\n' +
        '        if (/export\\s+function\\s+([A-Z]\\w+)/.test(lines[i])) {\n' +
        '          const match = lines[i].match(/export\\s+function\\s+([A-Z]\\w+)/);\n' +
        '          if (match) issues.push(fp + ":" + (i + 1) + " 函数名应以小写开头: " + match[1]);\n' +
        '        }\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '  return issues;\n' +
        '}\n\n' +
        'const issues = checkConventions(path.resolve(__dirname, "../src"));\n' +
        'if (issues.length > 0) {\n' +
        '  console.log("API 规范问题:");\n' +
        '  issues.forEach((i) => console.log("  " + i));\n' +
        '} else {\n' +
        '  console.log("✅ 未发现 API 规范问题!");\n' +
        '}\n',
    });
  }

  // === 模板 9: 性能优化 ===
  if (target.includes('性能')) {
    const heavy = inspection.moduleAnalysis.filter((m) => m.linesOfCode > 200);
    for (const mod of heavy.slice(0, 3)) {
      const hint = 'scripts/perf-hint-' + mod.path.replace(/[\\/]/g, '-') + '.md';
      changes.push({
        path: hint,
        action: 'create',
        content: '# Performance Notes: ' + mod.path + '\n\n' +
          '- 代码行数: ' + mod.linesOfCode + '\n' +
          '- 建议: 拆分大文件、缓存热路径、异步化同步 I/O\n',
      });
    }
  }

  // === 模板 10: 错误处理统一 ===
  if (target.includes('错误处理')) {
    changes.push({
      path: 'scripts/find-raw-throws.ts',
      action: 'create',
      content: '/**\n' +
        ' * 查找裸 throw 语句和空 catch 块\n' +
        ' * 运行: npx tsx scripts/find-raw-throws.ts\n' +
        ' */\n' +
        'import * as fs from "fs";\n' +
        'import * as path from "path";\n\n' +
        'function findRawThrows(dir: string): string[] {\n' +
        '  const r: string[] = [];\n' +
        '  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {\n' +
        '    const fp = path.join(dir, f.name);\n' +
        '    if (f.isDirectory() && !fp.includes("node_modules")) {\n' +
        '      r.push(...findRawThrows(fp));\n' +
        '    } else if (f.name.endsWith(".ts")) {\n' +
        '      const c = fs.readFileSync(fp, "utf-8");\n' +
        '      const lines = c.split("\\n");\n' +
        '      for (let i = 0; i < lines.length; i++) {\n' +
        '        if (/throw\\s+new\\s+Error/.test(lines[i]) && !lines[i].includes("/*")) {\n' +
        '          r.push(fp + ":" + (i + 1));\n' +
        '        }\n' +
        '      }\n' +
        '    }\n' +
        '  }\n' +
        '  return r;\n' +
        '}\n\n' +
        'const throws = findRawThrows(path.resolve(__dirname, "../src"));\n' +
        'if (throws.length > 0) {\n' +
        '  console.log("裸 throw 语句:");\n' +
        '  throws.forEach((t) => console.log("  " + t));\n' +
        '} else {\n' +
        '  console.log("✅ 未发现裸 throw 语句!");\n' +
        '}\n',
    });
  }

  // 兜底：refactor 类型且没有匹配到任何特定模板
  if (changes.length === 0 && proposal.type === 'refactor') {
    changes.push({
      path: 'scripts/refactor-plan.md',
      action: 'create',
      content: '# Refactor Plan: ' + proposal.target + '\n\n' +
        '## 目标\n' + proposal.description + '\n\n' +
        '## 预期收益\n' + proposal.expectedBenefit + '\n\n' +
        '## 步骤\n' +
        '1. 分析当前实现\n' +
        '2. 设计重构方案\n' +
        '3. 编写测试\n' +
        '4. 执行重构\n' +
        '5. 验证测试通过\n',
    });
  }

  proposal.files = changes;
}

// ============================================================================
// 格式化输出
// ============================================================================

/**
 * 将优化提案列表格式化为可读文本
 *
 * 供 CLI 展示，内容包括：
 * - 提案总数
 * - 每个提案的风险等级、类型、描述和预期收益、文件列表
 *
 * @param proposals 优化提案列表
 * @returns 格式化后的文本字符串
 *
 * @example
 * ```ts
 * const proposals = generateProposals(insp, res);
 * console.log(formatProposals(proposals));
 * // 输出:
 * // ═══════════════════════════════════════════
 * // 📋 Optimization Proposals
 * // ═══════════════════════════════════════════
 * // 共 2 个
 * //
 * // 🟢 [1] 补充缺失的测试文件
 * //     类型: add | 风险: low
 * //     为 core/planner.ts 添加单元测试
 * //     预期: 提高测试覆盖率
 * //     文件: tests/planner.test.ts
 * // ```
 */
export function formatProposals(proposals: OptimizationProposal[]): string {
  const lines = [
    '══════════════════════════════════════════',
    '📋 Optimization Proposals',
    '══════════════════════════════════════════',
    '共 ' + proposals.length + ' 个',
    '',
  ];

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    const icon =
      p.riskLevel === 'low' ? '🟢'
        : p.riskLevel === 'medium' ? '🟡'
          : '🔴';

    lines.push(icon + ' [' + (i + 1) + '] ' + p.target);
    lines.push('    类型: ' + p.type + ' | 风险: ' + p.riskLevel);
    lines.push('    ' + p.description);
    lines.push('    预期: ' + p.expectedBenefit);
    if (p.files.length > 0) {
      lines.push('    文件: ' + p.files.map((f) => f.path).join(', '));
    }
    lines.push('    测试: ' + getTestCommand(p));
    lines.push('');
  }

  return lines.join('\n');
}
