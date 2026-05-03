/**
 * @file index.ts — 类型定义统一导出（Barrel File）
 * @description
 *   作为类型模块的公共入口，将所有类型定义统一导出。
 *
 *   使用方式：
 *   ```typescript
 *   import type {
 *     ToolDefinition,
 *     ToolRegistry,
 *     AgentConfig,
 *     StructuredPlan,
 *     Skill,
 *   } from "../types/index.js";
 *   ```
 *
 * 领域划分：
 * - tool: 工具/工具箱/注册表
 * - config: 双层配置体系
 * - loop: 循环检测
 * - memory: 跨会话记忆
 * - context: 上下文管理
 * - planning: 规划系统
 * - pipeline: 线性管线
 * - stats: 性能监控
 * - skill: 技能系统
 * - clawhub: 技能市场
 * - session: 会话管理
 * - agent: Agent 运行结果
 *
 * @module types
 */

// 工具系统
export type {
  ToolPermission,
  Toolbox,
  ToolContext,
  ToolResult,
  ToolHandler,
  ToolDefinition,
  RegisteredTool,
  ToolRegistry,
} from "./tool.js";

// 配置系统
export type {
  ModelProfile,
  BuiltInProfile,
  ModelConfig,
  AgentConfig,
} from "./config.js";

// 循环检测
export type {
  LoopDetectionConfig,
  LoopLevel,
  LoopDetectionResult,
} from "./loop.js";

// 跨会话记忆
export type {
  MemoryEntry,
  MemoryEntryInput,
  SessionMemory,
  MemoryStore,
} from "./memory.js";

// 上下文管理
export type {
  TokenEstimate,
  ContextState,
  ContextManager,
} from "./context.js";

// 规划系统
export type {
  PlanStep,
  PlanChunk,
  SuggestedConfig,
  StructuredPlan,
} from "./planning.js";

// 线性管线
export type {
  PipelineStep,
  PipelineResult,
} from "./pipeline.js";

// 性能监控
export type {
  ToolStats,
  ToolMonitor,
} from "./stats.js";

// 技能系统
export type {
  SkillMetadata,
  SkillEntry,
  Skill,
  SkillPackage,
  SkillRegistry,
} from "./skill.js";

// 技能市场
export type {
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubClient,
} from "./clawhub.js";

// 会话管理
export type {
  SessionOptions,
  Session,
  SessionManager,
} from "./session.js";

// Agent 运行结果
export type {
  AgentRunResult,
  AgentRunOptions,
} from "./agent.js";
