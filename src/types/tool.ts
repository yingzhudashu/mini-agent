/**
 * @file tool.ts — 工具相关类型定义
 * @description
 *   Mini Agent 工具系统的核心类型，涵盖：
 *   - 工具定义（ToolDefinition）与注册表（ToolRegistry）
 *   - 工具执行上下文（ToolContext）与结果（ToolResult）
 *   - 权限级别（ToolPermission）
 *   - 工具箱（Toolbox）：粗粒度能力分组
 *
 * 设计原则：
 * - 接口尽量小且明确，避免过度抽象
 * - 使用 `readonly` 标记不可变字段
 * - 枚举用联合类型而非 `enum`（更好的 tree-shaking）
 *
 * @module types/tool
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// 权限与工具箱
// ============================================================================

/**
 * 工具权限级别
 * - sandbox: 沙箱保护，只能在 allowedPaths 内操作
 * - allowlist: 白名单模式，只允许预定义的命令操作
 * - require-confirm: 必须用户确认后才能执行
 */
export type ToolPermission = "sandbox" | "allowlist" | "require-confirm";

/**
 * 工具箱：粗粒度的能力分组
 *
 * Phase 1 规划阶段：LLM 根据工具箱描述决定需要哪些能力
 * Phase 2 执行阶段：只发送相关工具箱的工具给 LLM，节省 token
 */
export interface Toolbox {
  /** 工具箱唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 能力描述（供 LLM 理解） */
  description: string;
  /** 关键词，用于语义匹配 */
  keywords: string[];
}

// ============================================================================
// 工具执行
// ============================================================================

/**
 * 工具执行上下文
 *
 * 传递到每个工具的 handler 中，提供执行环境信息。
 */
export interface ToolContext {
  /** 当前工作目录 */
  cwd: string;
  /** 允许访问的路径列表（sandbox 模式下生效） */
  allowedPaths: string[];
  /** 权限级别 */
  permission: ToolPermission;
  /** 中止信号（可选，用于超时控制） */
  signal?: AbortSignal;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容 */
  content: string;
  /** 额外元数据（可选） */
  meta?: Record<string, unknown>;
}

/**
 * 工具处理器函数签名
 *
 * 接收工具调用参数和执行上下文，返回执行结果。
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

// ============================================================================
// 工具定义与注册表
// ============================================================================

/**
 * 工具定义：包含 schema、处理器、权限和帮助信息
 *
 * 每个工具通过 `toolbox` 字段可选绑定到一个工具箱 ID。
 * 未绑定 toolbox 的工具始终可用（视为核心能力）。
 */
export interface ToolDefinition {
  /** OpenAI tool_call schema */
  schema: ChatCompletionTool;
  /** 工具处理器 */
  handler: ToolHandler;
  /** 权限级别 */
  permission: ToolPermission;
  /** 帮助文本 */
  help: string;
  /** 所属工具箱 ID。未设置则始终包含（核心能力） */
  toolbox?: string;
}

/**
 * 已注册的工具（在 ToolDefinition 基础上增加名称）
 */
export interface RegisteredTool extends ToolDefinition {
  /** 工具名称（注册时指定） */
  name: string;
}

/**
 * 工具注册表接口
 *
 * 管理所有工具的生命周期：注册、注销、查询、按工具箱筛选。
 *
 * 内部使用 Map<string, RegisteredTool> 存储，
 * 保证 O(1) 的 get/set/delete 操作。
 */
export interface ToolRegistry {
  /** 注册一个工具 */
  register(name: string, tool: ToolDefinition): void;
  /** 注销一个工具 */
  unregister(name: string): boolean;
  /** 查询单个工具 */
  get(name: string): RegisteredTool | undefined;
  /** 获取所有工具 */
  getAll(): Map<string, RegisteredTool>;
  /** 获取所有工具的 OpenAI schema */
  getSchemas(): ChatCompletionTool[];
  /** 获取所有工具名称 */
  list(): string[];
  /** 按工具箱筛选，返回 schema 列表 */
  getSchemasByToolboxes(ids: string[]): ChatCompletionTool[];
  /** 按工具箱筛选，返回完整工具对象 */
  getByToolboxes(ids: string[]): Map<string, RegisteredTool>;
}
