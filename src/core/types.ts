/**
 * @file core/types.ts — 类型定义统一导出（向后兼容）
 * @description
 *   v4.8 重构：所有类型已拆分到 src/types/ 子目录，
 *   此文件仅作为 re-export barrel，保持向后兼容。
 *
 *   新代码请直接 import from "../types/index.js" 或具体类型文件。
 *
 * @deprecated 新代码请使用 `import type { ... } from "../types/index.js"`
 * @module core/types
 */

export type {
  // 工具系统
  ToolPermission,
  Toolbox,
  ToolContext,
  ToolResult,
  ToolHandler,
  ToolDefinition,
  RegisteredTool,
  ToolRegistry,
  // 配置系统
  ModelProfile,
  BuiltInProfile,
  ModelConfig,
  AgentConfig,
  // 循环检测
  LoopDetectionConfig,
  LoopLevel,
  LoopDetectionResult,
  // 跨会话记忆
  MemoryEntry,
  MemoryEntryInput,
  SessionMemory,
  MemoryStore,
  // 上下文管理
  TokenEstimate,
  ContextState,
  ContextManager,
  // 规划系统
  PlanStep,
  PlanChunk,
  SuggestedConfig,
  StructuredPlan,
  // 线性管线
  PipelineStep,
  PipelineResult,
  // 性能监控
  ToolStats,
  ToolMonitor,
  // 技能系统
  SkillMetadata,
  SkillEntry,
  Skill,
  SkillPackage,
  SkillRegistry,
  // 技能市场
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubClient,
  // 会话管理
  SessionOptions,
  Session,
  SessionManager,
  // Agent 运行结果
  AgentRunResult,
  AgentRunOptions,
} from "../types/index.js";
