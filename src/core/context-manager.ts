/**
 * @file context-manager.ts — Token 估算与上下文压缩管理
 * @description
 *   v4.6 新增：替代原始的 "消息数 > 12 就压缩" 策略。
 *
 *   核心机制：
 *   1. Token 估算：基于字符类型的启发式估算（中文 ~1.5 token/字，英文 ~4 字符/token）
 *   2. 上下文预算：总窗口 - 工具 schema - 系统 prompt - 输出预留
 *   3. 智能压缩：保留 system + 首条用户消息 + 最近 2 轮对话，中间历史做摘要
 *   4. 记忆注入：加载跨会话记忆后，注入到 system prompt
 *
 *   压缩策略：
 *   - 当 token 使用 > compressThreshold 时触发
 *   - 中间历史用一行描述替代（不调用 LLM，节省成本）
 *   - 保留最重要的上下文（system prompt + 最近对话）
 *
 * @module core/context-manager
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ContextManager, ContextState } from "./types.js";
import { formatMemoryForPrompt } from "./memory-store.js";
import type { SessionMemory } from "./types.js";

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 估算文本的 token 数量
 *
 * 启发式算法（适用于 Qwen 系列）：
 * - 中文字符：~1.5 token/字
 * - ASCII 字符：~4 字符/token
 *
 * 这是一个近似值，但足够用于判断是否需要压缩。
 */
function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;

  let chineseChars = 0;
  let asciiChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      chineseChars++;
    } else {
      asciiChars++;
    }
  }

  // 中文 1.5 token/字，ASCII 4 字符/token
  return Math.ceil(chineseChars * 1.5 + asciiChars / 4);
}

/**
 * 估算工具 schema 的 token 开销
 */
function estimateToolTokens(tools: ChatCompletionTool[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTokens(JSON.stringify(tool));
  }
  return total;
}

// ============================================================================
// Context Manager 实现
// ============================================================================

export class DefaultContextManager implements ContextManager {
  private messages: ChatCompletionMessageParam[] = [];
  private systemPrompt: string = "";
  private baseSystemPrompt: string = "";
  private contextWindow: number;
  private tools: ChatCompletionTool[] = [];
  private compressThreshold: number;
  private _compressed = false;
  private totalTokensEstimate = 0;

  constructor(
    contextWindow: number,
    compressThreshold: number,
    tools: ChatCompletionTool[] = [],
  ) {
    this.contextWindow = contextWindow;
    this.compressThreshold = compressThreshold;
    this.tools = tools;
  }

  // -----------------------------------------------------------------------
  // 公开 API
  // -----------------------------------------------------------------------

  /**
   * 初始化上下文（设置 system prompt 和用户输入）
   */
  init(systemPrompt: string, userInput: string): void {
    this.baseSystemPrompt = systemPrompt;
    this.systemPrompt = systemPrompt;
    this.messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ];
    this._compressed = false;
    this.recalculateTokens();
  }

  /**
   * 追加消息（LLM 回复或工具结果）
   * 追加后自动检查是否需要压缩
   */
  append(msg: ChatCompletionMessageParam): void {
    this.messages.push(msg);
    this.recalculateTokens();

    if (this.needsCompression()) {
      this.compress();
    }
  }

  /**
   * 检查是否需要压缩
   */
  needsCompression(): boolean {
    const budget = this.getAvailableBudget();
    if (budget <= 0) return true; // 无预算，必须压缩
    return this.totalTokensEstimate / budget > this.compressThreshold;
  }

  /**
   * 执行上下文压缩
   *
   * 策略：
   * - 保留：system prompt + 第 1 条用户消息
   * - 保留：最近 2 轮对话（LLM 回复 + 工具结果）
   * - 中间历史：替换为一行摘要
   */
  compress(): void {
    if (this.messages.length <= 4) return; // 消息太少，不需要压缩

    const keepStart = 2; // system + first user
    const keepEnd = 4; // 最近 2 轮（每轮 = LLM 回复 + 工具结果）

    const middleStart = keepStart;
    const middleEnd = Math.max(keepStart, this.messages.length - keepEnd);

    if (middleEnd <= middleStart) return; // 没有中间消息

    // 计算中间消息的统计
    const middleMessages = this.messages.slice(middleStart, middleEnd);
    const removedTokens = middleMessages.reduce(
      (sum, m) => sum + this.messageTokens(m),
      0,
    );
    const removedCount = middleMessages.length;

    // 生成摘要
    const toolCalls: string[] = [];
    const userMsgs: string[] = [];
    for (const m of middleMessages) {
      if (m.role === "user" && typeof m.content === "string") {
        userMsgs.push(m.content.slice(0, 50));
      }
      if (m.role === "assistant" && m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          toolCalls.push(tc.function.name);
        }
      }
    }

    let summary = `（已压缩 ${removedCount} 条历史消息，节省 ~${removedTokens} tokens）`;
    if (toolCalls.length > 0) {
      const uniqueTools = [...new Set(toolCalls)];
      summary += `。期间使用了：${uniqueTools.join("、")}`;
    }
    if (userMsgs.length > 0) {
      summary += `。用户询问了：${userMsgs.join("；")}`;
    }

    // 替换中间消息
    this.messages.splice(middleStart, middleEnd - middleStart, {
      role: "system",
      content: summary,
    });

    this._compressed = true;
    this.recalculateTokens();
  }

  /**
   * 注入记忆摘要到 system prompt
   */
  injectMemory(memory: SessionMemory | null): void {
    const memoryText = formatMemoryForPrompt(memory);
    if (!memoryText) return;

    // 在 base system prompt 后面追加记忆
    this.systemPrompt = `${this.baseSystemPrompt}\n\n${memoryText}`;

    // 更新 messages 中的 system prompt
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      (this.messages[0] as any).content = this.systemPrompt;
    }

    this.recalculateTokens();
  }

  /**
   * 获取当前消息列表（供 LLM 调用使用）
   */
  getMessages(): ChatCompletionMessageParam[] {
    return [...this.messages];
  }

  /**
   * 获取当前上下文状态
   */
  getState(): ContextState {
    return {
      messages: this.getMessages(),
      totalTokens: this.totalTokensEstimate,
      compressed: this._compressed,
    };
  }

  /**
   * 获取 token 使用报告
   */
  getTokenReport(): string {
    const budget = this.getAvailableBudget();
    const usage = this.totalTokensEstimate;
    const pct = budget > 0 ? ((usage / budget) * 100).toFixed(1) : "N/A";

    return `📊 Token 使用: ${usage} / ${budget} (${pct}%) | 消息数: ${this.messages.length} | 已压缩: ${this._compressed}`;
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 获取可用于对话历史的 token 预算
   */
  private getAvailableBudget(): number {
    const toolTokens = estimateToolTokens(this.tools);
    const systemTokens = estimateTokens(this.systemPrompt);
    // 预留 10% 给输出
    const outputReserve = Math.ceil(this.contextWindow * 0.1);

    return Math.max(0, this.contextWindow - toolTokens - systemTokens - outputReserve);
  }

  /**
   * 估算单条消息的 token 数
   */
  private messageTokens(msg: ChatCompletionMessageParam): number {
    let tokens = estimateTokens(msg.content as string | null);

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      tokens += estimateTokens(JSON.stringify(msg.tool_calls));
    }

    // 角色标记额外开销
    tokens += 5;

    return tokens;
  }

  /**
   * 重新计算总 token 估算
   */
  private recalculateTokens(): void {
    this.totalTokensEstimate = this.messages.reduce(
      (sum, m) => sum + this.messageTokens(m),
      0,
    );
  }
}
