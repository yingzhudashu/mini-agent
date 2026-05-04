/**
 * @file tool.ts — 工具系统与上下文管理类型
 * @description
 *   Mini Agent 的核心类型，涵盖：
 *   - 工具定义（ToolDefinition）与注册表（ToolRegistry）
 *   - 工具执行上下文（ToolContext）与结果（ToolResult）
 *   - 权限级别（ToolPermission）
 *   - 工具箱（Toolbox）：粗粒度能力分组
 *   - 上下文管理（v4.6）：Token 估算、上下文压缩
 *
 * @module types/tool
 */

import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources/chat/completions";

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

// ============================================================================
// 上下文管理（v4.6 新增）
// ============================================================================

import type { SessionMemory } from "./memory.js";

/**
 * 消息的 token 估算结果
 */
export interface TokenEstimate {
  /** 估算的 token 数 */
  tokens: number;
  /** 原始字符长度 */
  charLength: number;
}

/**
 * 上下文状态：跟踪当前消息列表的 token 使用
 */
export interface ContextState {
  /** 当前消息列表 */
  messages: ChatCompletionMessageParam[];
  /** 当前估算的总 token 数 */
  totalTokens: number;
  /** 是否已被压缩过 */
  compressed: boolean;
}

/**
 * 上下文管理器接口
 */
export interface ContextManager {
  /** 获取当前上下文状态 */
  getState(): ContextState;
  /** 初始化消息（system + user） */
  init(systemPrompt: string, userInput: string): void;
  /** 追加消息并检查是否需要压缩 */
  append(msg: ChatCompletionMessageParam): void;
  /** 检查是否需要压缩 */
  needsCompression(): boolean;
  /** 执行压缩（保留首尾，中间摘要） */
  compress(): void;
  /** 注入记忆摘要到 system prompt */
  injectMemory(memory: SessionMemory | null): void;
  /** 获取当前 token 使用报告 */
  getTokenReport(): string;
  /** 获取当前消息列表 */
  getMessages(): ChatCompletionMessageParam[];
}
