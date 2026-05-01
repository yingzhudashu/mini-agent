/**
 * @file types.ts — 类型定义
 * @description
 *   Mini Agent v4 的所有 TypeScript 接口和类型。
 *
 *   类型分类：
 *   1. Toolbox — 工具箱定义（粗粒度能力分组）
 *   2. Tool* — 工具相关（定义、上下文、结果、注册表）
 *   3. ModelConfig / AgentConfig — 双层配置体系
 *   4. Planning — 规划相关（StructuredPlan、PlanStep、PlanChunk）
 *   5. Pipeline — 线性管线执行
 *   6. Stats — 性能监控统计
 *   7. Skill — 技能包系统
 *   8. ClawHub — 技能市场（v4.1 新增）
 *   9. LoopDetection — 循环检测（v4.1 新增）
 *   10. ModelProfile — 模型配置预设（v4.1 新增）
 *
 *   设计原则：
 *   - 接口尽量小且明确，避免过度抽象
 *   - 使用 `readonly` 标记不可变字段
 *   - 可选字段使用 `?` 标注
 *   - 枚举用联合类型而非 `enum`（更好的 tree-shaking）
 *
 * @module core/types
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// Toolbox types — 工具箱定义
// ============================================================================

/**
 * 工具权限级别
 * - sandbox: 沙箱保护，只能在 allowedPaths 内操作
 * - allowlist: 白名单模式，只允许预定义的命令/操作
 * - require-confirm: 必须用户确认后才能执行
 */
export type ToolPermission = "sandbox" | "allowlist" | "require-confirm";

/**
 * 工具箱：粗粒度的能力分组
 *
 * 在 Phase 1 规划阶段，LLM 根据工具箱描述决定需要哪些能力。
 * 在 Phase 2 执行阶段，只发送相关工具箱的工具给 LLM，节省 token。
 */
export interface Toolbox {
  id: string;
  name: string;
  description: string;
  keywords: string[];
}

/**
 * 工具执行上下文
 *
 * 传递到每个工具的 handler 中，提供执行环境信息。
 */
export interface ToolContext {
  cwd: string;
  allowedPaths: string[];
  permission: ToolPermission;
  signal?: AbortSignal;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  content: string;
  meta?: Record<string, unknown>;
}

/**
 * 工具处理器函数签名
 */
export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

/**
 * 工具定义：包含 schema、处理器、权限和帮助信息
 */
export interface ToolDefinition {
  schema: ChatCompletionTool;
  handler: ToolHandler;
  permission: ToolPermission;
  help: string;
  /** 所属工具箱 ID。未设置则始终包含（核心能力） */
  toolbox?: string;
}

/**
 * 已注册的工具（在 ToolDefinition 基础上增加名称）
 */
export interface RegisteredTool extends ToolDefinition {
  name: string;
}

/**
 * 工具注册表接口
 *
 * 管理所有工具的生命周期：注册、注销、查询、筛选。
 */
export interface ToolRegistry {
  register(name: string, tool: ToolDefinition): void;
  unregister(name: string): boolean;
  get(name: string): RegisteredTool | undefined;
  getAll(): Map<string, RegisteredTool>;
  getSchemas(): ChatCompletionTool[];
  list(): string[];
  getSchemasByToolboxes(ids: string[]): ChatCompletionTool[];
  getByToolboxes(ids: string[]): Map<string, RegisteredTool>;
}

// ============================================================================
// Loop Detection — 循环检测（v4.1 新增）
// ============================================================================

/**
 * 循环检测配置
 *
 * 参考 OpenClaw 的 loop-detection 机制，防止 Agent 陷入无限循环。
 *
 * 检测器类型：
 * - genericRepeat: 检测相同工具 + 相同参数的重复调用
 * - knownPollNoProgress: 检测已知轮询模式但无状态变化
 * - pingPong: 检测交替的 ping-pong 模式
 */
export interface LoopDetectionConfig {
  /** 是否启用循环检测（默认 true） */
  enabled: boolean;
  /** 保留的最近工具调用历史条数（默认 30） */
  historySize: number;
  /** 警告阈值：超过此次数标记为 warning（默认 5） */
  warningThreshold: number;
  /** 严重阈值：超过此次数强制终止（默认 8） */
  criticalThreshold: number;
  /** 检测器开关 */
  detectors: {
    genericRepeat: boolean;
    knownPollNoProgress: boolean;
    pingPong: boolean;
  };
}

/**
 * 循环检测事件级别
 */
export type LoopLevel = "none" | "warning" | "critical";

/**
 * 循环检测结果
 */
export interface LoopDetectionResult {
  level: LoopLevel;
  message: string;
  /** 重复的工具调用模式 */
  pattern?: string;
}

// ============================================================================
// Model Config — 模型层配置
// ============================================================================

/**
 * 模型配置预设（参考 OpenClaw 的 model profiles）
 *
 * 针对不同复杂度任务提供预调优的模型参数。
 */
export interface ModelProfile {
  /** 预设名称 */
  name: string;
  /** 温度（创造性 vs 确定性） */
  temperature: number;
  /** top_p 采样 */
  topP: number;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** thinking 级别 */
  thinkingLevel: "disabled" | "light" | "medium" | "heavy";
  /** thinking token 预算 */
  thinkingBudget: number;
  /** 适用场景描述 */
  description: string;
}

/**
 * 内置预设名称
 */
export type BuiltInProfile = "creative" | "balanced" | "precise" | "code" | "fast";

/**
 * 模型配置
 *
 * 参考 OpenClaw 的分层配置体系：基础配置 + 预设覆盖 + 运行时覆盖。
 */
export interface ModelConfig {
  /** API 端点 */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** 温度（0.0-2.0） */
  temperature: number;
  /** top_p 采样（0.0-1.0） */
  topP: number;
  /** 最大输出 token 数 */
  maxTokens: number;
  /** thinking 级别（适用于支持 thinking 的模型） */
  thinkingLevel: "disabled" | "light" | "medium" | "heavy";
  /** thinking token 预算 */
  thinkingBudget: number;
  /** 上下文窗口大小（token） */
  contextWindow: number;
  /** 是否使用流式输出 */
  stream: boolean;
  /** API 调用重试次数 */
  retryCount: number;
  /** 模型配置预设（用于快速切换） */
  profiles?: Record<string, ModelProfile>;
  /** 当前使用的预设名称 */
  activeProfile?: string;
}

// ============================================================================
// Agent Config — Agent 层配置
// ============================================================================

/**
 * Agent 配置
 *
 * 参考 OpenClaw 的配置体系：
 * - maxTurns / loopDetection: 防止无限循环
 * - contextOverflowStrategy: 上下文溢出处理
 * - toolSelectionStrategy: 工具选择策略
 * - modelOverrides: 运行时模型覆盖
 */
export interface AgentConfig {
  /** 最大轮数（ReAct loop 迭代次数，默认 10） */
  maxTurns: number;
  /** 工具超时（秒，默认 30） */
  toolTimeout: number;
  /** HTTP 超时（秒，默认 60） */
  httpTimeout: number;
  /** 上下文保留比例（默认 0.2，即保留 20% 窗口给新输入） */
  contextReserveRatio: number;
  /** 上下文溢出处理策略 */
  contextOverflowStrategy: "summarize" | "truncate" | "error";
  /** 是否压缩消息（移除冗余空白、缩短工具结果） */
  compressMessages: boolean;
  /** 工具选择策略 */
  toolSelectionStrategy: "all" | "toolbox" | "auto";
  /** 是否自动确认执行（跳过 onPlan 确认） */
  autoExecuteConfirmed: boolean;
  /** 是否允许并行工具调用 */
  allowParallelTools: boolean;
  /** 响应语言（默认 zh-CN） */
  responseLanguage: string;
  /** 响应格式 */
  responseFormat: "text" | "markdown" | "structured";
  /** 调试模式 */
  debug: boolean;
  /** 是否记录 token 用量 */
  logTokenUsage: boolean;
  /** 增量日志文件路径，null 则不记录 */
  logFile: string | null;
  /** 输出管理器（用于 CLI 稳定输出） */
  outputManager?: { beginOutput(): void; endOutput(): void; write(text: string): void; writeLines(lines: string[]): void } | null;
  /** 循环检测配置（v4.1 新增） */
  loopDetection?: Partial<LoopDetectionConfig>;
  /** 模型覆盖（运行时可动态切换模型参数） */
  modelOverrides?: Partial<ModelConfig>;
}

// ============================================================================
// Planning types — 规划相关
// ============================================================================

export interface SuggestedConfig {
  maxTurns?: number;
  toolTimeout?: number;
  contextOverflowStrategy?: "summarize" | "truncate" | "error";
  toolSelectionStrategy?: "all" | "toolbox" | "auto";
  modelOverrides?: Partial<ModelConfig>;
  thinkingLevel?: "disabled" | "light" | "medium" | "heavy";
  chunkExecution?: boolean;
  chunkTokenBudget?: number;
  parallelism?: "sequential" | "safe-parallel" | "full-parallel";
  riskLevel?: "low" | "medium" | "high";
}

export interface PlanStep {
  stepNumber: number;
  description: string;
  requiredToolboxes: string[];
  expectedInput: string;
  expectedOutput: string;
  dependsOn?: number;
}

export interface PlanChunk {
  chunkNumber: number;
  steps: PlanStep[];
  estimatedTokens: number;
  chunkSystemPrompt: string;
}

export interface StructuredPlan {
  summary: string;
  steps: PlanStep[];
  requiredToolboxes: string[];
  suggestedConfig: SuggestedConfig;
  estimatedTokens: {
    promptTokens: number;
    completionTokens: number;
    toolResultTokens: number;
    total: number;
  };
  contextStrategy: {
    mode: "normal" | "chunked" | "summarize" | "truncate";
    chunks?: PlanChunk[];
    reason: string;
  };
  requiresConfirmation: boolean;
  confirmationMessage?: string;
  riskLevel: "low" | "medium" | "high";
  estimatedCost: {
    inputTokens: number;
    outputTokens: number;
    totalUSD: number;
  };
  outputSpec: {
    language: string;
    format: "text" | "markdown" | "structured";
    expectedDeliverable: string;
  };
  fallbackPlan: {
    degradeToSimple: boolean;
    degradedMaxTurns: number;
  };
}

// ============================================================================
// Pipeline types — 线性管线执行
// ============================================================================

export interface PipelineStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface PipelineResult {
  steps: { tool: string; args: Record<string, unknown>; result: ToolResult }[];
  finalContent: string;
  success: boolean;
}

// ============================================================================
// Stats types — 性能监控统计
// ============================================================================

export interface ToolStats {
  calls: number;
  totalMs: number;
  successCount: number;
  failCount: number;
  errors: string[];
}

export interface ToolMonitor {
  record(tool: string, durationMs: number, success: boolean): void;
  getStats(tool: string): ToolStats | undefined;
  getAllStats(): Map<string, ToolStats>;
  report(): string;
}

// ============================================================================
// Skill types — 技能包系统
// ============================================================================

/**
 * 技能元数据（gating 信息，参考 OpenClaw 的 metadata.openclaw）
 */
export interface SkillMetadata {
  /** 必需的系统二进制文件 */
  bins?: string[];
  /** 必需的环境变量 */
  env?: string[];
  /** 必需的 AgentConfig 键 */
  config?: string[];
  /** 主环境变量名（用于 apiKey 注入） */
  primaryEnv?: string;
  /** 适用操作系统 */
  os?: string[];
  /** 始终加载（跳过其他 gate） */
  always?: boolean;
  /** 技能唯一键（用于 skills.entries 配置） */
  skillKey?: string;
  /** 用户可调用（作为 slash 命令） */
  userInvocable?: boolean;
  /** 排除模型调用 */
  disableModelInvocation?: boolean;
}

/**
 * 技能配置覆盖（参考 OpenClaw 的 skills.entries）
 */
export interface SkillEntry {
  /** 是否启用 */
  enabled?: boolean;
  /** 注入的环境变量 */
  env?: Record<string, string>;
  /** API Key（支持明文或 SecretRef） */
  apiKey?: string | { source: string; provider: string; id: string };
  /** 自定义配置 */
  config?: Record<string, unknown>;
}

/**
 * 技能：一个独立的、可复用的能力单元
 *
 * 每个技能可以贡献：
 * 1. 工具定义（tools）— 注册到 ToolRegistry
 * 2. 工具箱（toolboxes）— 用于 Phase 1 规划筛选
 * 3. 系统提示词增强（systemPrompt）— 追加到 system prompt
 * 4. SKILL.md — 人类可读的技能说明文档
 * 5. 元数据（metadata）— gating 和安装信息
 *
 * 与 Toolbox 的区别：
 * - Toolbox 是纯描述性的（id + name + description + keywords）
 * - Skill 是功能性的：包含实际的工具实现 + 文档 + 系统提示
 */
export interface Skill {
  /** 技能唯一标识 */
  id: string;
  /** 技能名称 */
  name: string;
  /** 技能描述（用于 LLM 规划阶段理解能力） */
  description: string;
  /** 关键词，辅助 LLM 匹配 */
  keywords: string[];
  /** 贡献的工具定义 */
  tools?: Record<string, ToolDefinition>;
  /** 贡献的工具箱 */
  toolboxes?: Toolbox[];
  /** 追加到 system prompt 的指令 */
  systemPrompt?: string;
  /** SKILL.md 原始内容 */
  skillMd?: string;
  /** 技能元数据（gating） */
  metadata?: SkillMetadata;
  /** 来源路径 */
  sourcePath?: string;
}

/**
 * 技能包：一组相关技能的集合
 *
 * 目录结构：
 * ```
 * skills/<package-name>/
 *   ├── SKILL.md          # 技能包总览文档
 *   ├── index.ts          # 技能包入口（导出 Skill[]）
 *   └── <skill-id>/
 *       ├── SKILL.md      # 单个技能文档
 *       └── tools.ts      # 工具定义
 * ```
 */
export interface SkillPackage {
  /** 技能包唯一标识（通常等于目录名） */
  id: string;
  /** 技能包名称 */
  name: string;
  /** 技能包描述 */
  description: string;
  /** 包含的技能列表 */
  skills: Skill[];
  /** SKILL.md 原始内容 */
  skillMd?: string;
  /** 加载来源路径 */
  sourcePath: string;
}

/**
 * 技能注册表接口
 */
export interface SkillRegistry {
  register(skill: Skill): void;
  unregister(id: string): boolean;
  get(id: string): Skill | undefined;
  getAll(): Skill[];
  getPackages(): SkillPackage[];
  registerPackage(pkg: SkillPackage): void;
  getAllToolboxes(): Toolbox[];
  getAllTools(): Record<string, ToolDefinition>;
  getSystemPrompts(): string[];
  /** 根据配置过滤后的可用技能（考虑 gating） */
  getEligibleSkills(config?: AgentConfig): Skill[];
  /** 获取技能配置覆盖 */
  getSkillEntry(id: string): SkillEntry | undefined;
}

// ============================================================================
// ClawHub types — 技能市场（v4.1 新增）
// ============================================================================

/**
 * ClawHub 技能搜索结果
 */
export interface ClawHubSearchResult {
  /** 技能 slug */
  slug: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 当前版本 */
  version: string;
  /** 标签 */
  tags: string[];
  /** 下载量 */
  downloads: number;
  /** 星标数 */
  stars: number;
  /** 作者 */
  author: string;
}

/**
 * ClawHub 技能详情
 */
export interface ClawHubSkillDetail {
  slug: string;
  name: string;
  description: string;
  version: string;
  tags: string[];
  /** SKILL.md 内容 */
  skillMd: string;
  /** 技能文件列表 */
  files: { path: string; content: string }[];
}

/**
 * ClawHub 客户端接口
 */
export interface ClawHubClient {
  /** 搜索技能 */
  search(query: string, limit?: number): Promise<ClawHubSearchResult[]>;
  /** 获取技能详情 */
  getDetail(slug: string): Promise<ClawHubSkillDetail>;
  /** 下载技能包 */
  download(slug: string, version?: string): Promise<{ path: string; files: { path: string; content: string }[] }>;
}
