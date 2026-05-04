/**
 * @file index.ts — 类型定义统一导出（Barrel File）
 * @description
 *   类型模块的公共入口，将所有类型定义统一导出。
 *
 *   领域划分（6 个文件）：
 *   - tool: 工具/工具箱/注册表 + 上下文管理
 *   - config: 双层配置体系
 *   - memory: 记忆存储 + 会话管理
 *   - skill: 技能系统 + ClawHub 技能市场
 *   - agent: Agent 运行结果 + 统计 + 循环检测 + 管线
 *   - planning: 规划系统
 *
 * @module types
 */

// 工具系统 + 上下文管理
export type {
  ToolPermission,
  Toolbox,
  ToolContext,
  ToolResult,
  ToolHandler,
  ToolDefinition,
  RegisteredTool,
  ToolRegistry,
  TokenEstimate,
  ContextState,
  ContextManager,
} from "./tool.js";

// 配置系统
export type {
  ModelProfile,
  BuiltInProfile,
  ModelConfig,
  AgentConfig,
} from "./config.js";

// 记忆 + 会话管理
export type {
  MemoryEntry,
  MemoryEntryInput,
  SessionMemory,
  MemoryStore,
  SessionOptions,
  Session,
  SessionManager,
} from "./memory.js";

// 技能系统 + ClawHub
export type {
  SkillMetadata,
  SkillEntry,
  Skill,
  SkillPackage,
  SkillRegistry,
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubClient,
} from "./skill.js";

// Agent 运行结果 + 统计 + 循环检测 + 管线
export type {
  AgentRunResult,
  AgentRunOptions,
  ToolStats,
  ToolMonitor,
  LoopDetectionConfig,
  LoopLevel,
  LoopDetectionResult,
  PipelineStep,
  PipelineResult,
} from "./agent.js";

// 规划系统
export type {
  PlanStep,
  PlanChunk,
  SuggestedConfig,
  StructuredPlan,
} from "./planning.js";

// 飞书集成
export type {
  FeishuMessageEvent,
  FeishuConfig,
  FeishuMessagePayload,
  AgentMessageResult,
} from "./feishu.js";
