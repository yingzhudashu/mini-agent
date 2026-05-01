/**
 * @file types.ts — Self-Optimization 类型定义
 * @description
 *   Self-Optimization 子系统的所有 TypeScript 接口和类型。
 *
 *   类型分类：
 *   1. OptimizationProposal — 优化提案
 *   2. TestCase — 测试用例
 *   3. OptimizationResult — 优化结果
 *   4. InspectionReport — 自我审视报告
 *   5. ResearchReport — 外部调研报告
 *   6. OptimizationLog — 优化历史记录
 *
 *   设计原则：
 *   - 所有提案必须有测试用例和风险评估
 *   - 风险等级驱动执行策略（auto / confirm / block）
 *   - 每次优化可追溯、可回滚
 *
 * @module core/self-opt/types
 */

// ============================================================================
// Risk Level — 风险等级
// ============================================================================

/**
 * 优化操作风险等级
 *
 * - low: 低风险，可自动执行（如：添加新工具、改进注释、优化配置）
 * - medium: 中风险，需用户确认（如：修改现有工具逻辑、添加依赖）
 * - high: 高风险，必须确认 + 快照（如：修改核心模块、重构架构）
 * - destructive: 破坏性，必须确认 + 手动审核（如：删除文件、覆盖关键配置）
 */
export type RiskLevel = "low" | "medium" | "high" | "destructive";

// ============================================================================
// TestCase — 测试用例
// ============================================================================

/**
 * 测试用例类型
 * - unit: 单元测试（单个函数/模块）
 * - integration: 集成测试（模块间交互）
 * - e2e: 端到端测试（完整流程）
 */
export type TestCaseType = "unit" | "integration" | "e2e";

/**
 * 测试用例
 *
 * 每个优化提案必须附带至少一个测试用例。
 */
export interface TestCase {
  /** 测试用例唯一 ID */
  id: string;
  /** 测试类型 */
  type: TestCaseType;
  /** 测试描述 */
  description: string;
  /** 前置条件（setup 步骤） */
  setup: string;
  /** 执行的操作 */
  action: string;
  /** 预期结果 */
  expected: string;
  /** 可执行的测试命令 */
  command: string;
  /** 测试文件路径（如果生成到文件） */
  testFilePath?: string;
}

// ============================================================================
// OptimizationProposal — 优化提案
// ============================================================================

/**
 * 优化类型
 * - add: 新增功能/工具/模块
 * - remove: 移除废弃代码/工具
 * - modify: 修改现有实现
 * - refactor: 重构（不改变功能）
 */
export type OptimizationType = "add" | "remove" | "modify" | "refactor";

/**
 * 文件变更描述
 */
export interface FileChange {
  /** 文件路径（相对于项目根目录） */
  path: string;
  /** 变更类型 */
  action: "create" | "modify" | "delete";
  /** 新内容（create/modify 时必填） */
  content?: string;
  /** 变更说明 */
  description?: string;
}

/**
 * 优化提案
 *
 * 由 ProposalEngine 生成，包含完整的改动计划和验证方案。
 */
export interface OptimizationProposal {
  /** 提案唯一 ID */
  id: string;
  /** 优化类型 */
  type: OptimizationType;
  /** 风险等级 */
  riskLevel: RiskLevel;
  /** 目标模块/文件 */
  target: string;
  /** 改动说明 */
  description: string;
  /** 优化依据（参考了哪些先进模式/论文） */
  rationale: string;
  /** 预期收益 */
  expectedBenefit: string;
  /** 文件变更列表 */
  files: FileChange[];
  /** 需要安装的新依赖 */
  dependencies: string[];
  /** 关联的测试用例 */
  testCases: TestCase[];
  /** 回滚方案 */
  rollbackPlan?: string;
  /** 预估实施时间（秒） */
  estimatedTimeSeconds?: number;
}

// ============================================================================
// InspectionReport — 自我审视报告
// ============================================================================

/**
 * 代码质量指标
 */
export interface CodeQualityMetric {
  /** 指标名称 */
  name: string;
  /** 当前值 */
  value: number | string;
  /** 建议值/目标值 */
  target?: string;
  /** 是否达标 */
  passed: boolean;
  /** 说明 */
  note?: string;
}

/**
 * 模块分析结果
 */
export interface ModuleAnalysis {
  /** 模块路径 */
  path: string;
  /** 代码行数 */
  linesOfCode: number;
  /** 是否有对应测试 */
  hasTests: boolean;
  /** 导出的函数/类数量 */
  exportsCount: number;
  /** 导入的模块数量 */
  importsCount: number;
  /** 复杂度评分（1-10，越高越复杂） */
  complexityScore: number;
  /** 发现的问题 */
  issues: string[];
}

/**
 * 架构完整性检查项
 */
export interface ArchitectureCheck {
  /** 检查项名称 */
  name: string;
  /** 是否通过 */
  passed: boolean;
  /** 详情 */
  details: string;
  /** 建议改进 */
  recommendation?: string;
}

/**
 * 自我审视报告
 *
 * 由 Inspector 生成，包含代码质量、架构完整性、痛点分析。
 */
export interface InspectionReport {
  /** 生成时间 */
  timestamp: string;
  /** 项目版本 */
  version: string;
  /** 代码质量指标 */
  qualityMetrics: CodeQualityMetric[];
  /** 模块分析 */
  moduleAnalysis: ModuleAnalysis[];
  /** 架构完整性检查 */
  architectureChecks: ArchitectureCheck[];
  /** 痛点列表（高频失败、循环检测触发等） */
  painPoints: {
    description: string;
    severity: "low" | "medium" | "high";
    evidence: string;
  }[];
  /** 优化建议（初步） */
  suggestions: string[];
  /** 总评 */
  summary: string;
}

// ============================================================================
// ResearchReport — 外部调研报告
// ============================================================================

/**
 * 外部架构/项目信息
 */
export interface ExternalReference {
  /** 来源类型 */
  type: "paper" | "github" | "blog" | "docs";
  /** 标题 */
  title: string;
  /** URL */
  url: string;
  /** 摘要/描述 */
  summary: string;
  /** 发表/更新时间 */
  date?: string;
  /** 可借鉴的架构模式 */
  patterns: string[];
  /** 对我们的适用性评分（1-10） */
  relevance: number;
}

/**
 * 外部调研报告
 *
 * 由 Researcher 生成，包含最新架构模式和可借鉴方案。
 */
export interface ResearchReport {
  /** 生成时间 */
  timestamp: string;
  /** 搜索关键词 */
  searchQueries: string[];
  /** 参考资源 */
  references: ExternalReference[];
  /** 提取的架构模式 */
  extractedPatterns: {
    name: string;
    description: string;
    sourceReferences: string[]; // reference titles
    applicability: string;
  }[];
  /** 总结 */
  summary: string;
}

// ============================================================================
// OptimizationResult — 优化结果
// ============================================================================

/**
 * 优化执行状态
 */
export type OptimizationStatus = "success" | "failed" | "reverted" | "skipped";

/**
 * 单个测试执行结果
 */
export interface TestExecutionResult {
  /** 测试用例 ID */
  testCaseId: string;
  /** 是否通过 */
  passed: boolean;
  /** 输出日志 */
  output: string;
  /** 执行耗时（ms） */
  durationMs: number;
}

/**
 * 优化结果
 *
 * 记录每次优化执行的最终结果。
 */
export interface OptimizationResult {
  /** 关联的提案 ID */
  proposalId: string;
  /** 执行状态 */
  status: OptimizationStatus;
  /** Git commit hash（实施前快照） */
  gitSnapshot?: string;
  /** 测试执行结果 */
  testResults: TestExecutionResult[];
  /** 测试汇总 */
  testSummary: {
    total: number;
    passed: number;
    failed: number;
  };
  /** 自动修复尝试次数 */
  fixAttempts: number;
  /** 是否已回滚 */
  reverted: boolean;
  /** 经验教训 */
  lesson: string;
  /** 执行时间戳 */
  timestamp: string;
  /** 总耗时（秒） */
  totalDurationSeconds: number;
}

// ============================================================================
// OptimizationLog — 优化历史记录
// ============================================================================

/**
 * 优化历史记录条目
 */
export interface OptimizationLogEntry {
  result: OptimizationResult;
  proposal: {
    id: string;
    type: OptimizationType;
    target: string;
    description: string;
    riskLevel: RiskLevel;
  };
}

/**
 * 优化历史汇总
 */
export interface OptimizationSummary {
  totalOptimizations: number;
  successful: number;
  failed: number;
  reverted: number;
  lastOptimization?: string;
  topPainPointsResolved: string[];
}
