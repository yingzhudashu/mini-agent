/**
 * @file context.ts — 上下文管理类型
 * @description
 *   v4.6 新增：Token 估算与上下文压缩管理。
 *
 *   核心机制：
 *   1. Token 估算：基于字符类型的启发式估算
 *   2. 上下文预算：总窗口 - 工具 schema - 系统 prompt - 输出预留
 *   3. 智能压缩：保留 system + 首条用户消息 + 最近 2 轮对话
 *   4. 记忆注入：加载跨会话记忆后，注入到 system prompt
 *
 * @module types/context
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SessionMemory } from "./memory.js";

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 消息的 token 估算结果
 */
export interface TokenEstimate {
  /** 估算的 token 数 */
  tokens: number;
  /** 原始字符长度 */
  charLength: number;
}

// ============================================================================
// 上下文状态
// ============================================================================

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

// ============================================================================
// 上下文管理器接口
// ============================================================================

/**
 * 上下文管理器接口
 *
 * 负责管理 LLM 对话的消息历史，包括：
 * - Token 估算与预算管理
 * - 上下文压缩（当接近窗口限制时）
 * - 记忆注入（将跨会话记忆融入 system prompt）
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
