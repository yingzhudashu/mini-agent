/**
 * @file executor.ts — ReAct 循环执行器
 * @description
 *   Phase 2 核心：执行结构化计划，实现 ReAct 循环（Think → Act → Observe）。
 *
 *   工作流程：
 *   1. 根据 plan.requiredToolboxes 筛选工具
 *   2. 初始化循环检测器（v4.1）
 *   3. 初始化上下文管理器（v4.6）
 *   4. 注入三层记忆（v4.6）
 *   5. ReAct 循环：LLM 调用 → 工具执行 → 结果反馈
 *   6. 循环直到：LLM 不再调用工具 / 达到 maxTurns / 被循环检测拦截
 *
 *   v4.1 新增机制：
 *   - 循环检测（LoopDetector）：防止无限循环
 *   - 上下文压缩：消息过长时自动摘要历史
 *
 *   工具调用处理：
 *   - 支持并行工具调用（LLM 一次返回多个 tool_calls）
 *   - 按顺序执行每个工具（目前不支持真正的并行执行）
 *   - 未知工具返回错误信息，不中断循环
 *   - 工具执行异常被捕获为失败结果，不抛出
 *
 * @module core/executor
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  ToolRegistry,
  ToolMonitor,
  ToolContext,
  StructuredPlan,
  AgentConfig,
} from "../types/index.js";
import { DefaultToolMonitor } from "./monitor.js";
import { getDefaultWorkspace } from "../security/sandbox.js";
import { getDefaultModelConfig } from "./config.js";
import { appendLog, truncate } from "./logger.js";
import { LoopDetector } from "./loop-detector.js";
import { DEFAULT_LOOP_DETECTION } from "./config.js";
import { DefaultContextManager } from "./context-manager.js";
import { memoryStore, extractFacts, generateTurnSummary } from "./memory-store.js";
import { searchRelevantMemory, formatSearchResults, getIndexStats } from "./keyword-index.js";

// ============================================================================
// OpenAI 客户端（共享实例）
// ============================================================================

/** 全局共享的 OpenAI 客户端实例 */
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

/** 当前使用的模型名称 */
export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================================
// ReAct 循环执行器
// ============================================================================

/**
 * 执行结构化计划（ReAct 循环）
 *
 * 这是 Agent 的核心执行逻辑。
 *
 * @param plan - 结构化执行计划（来自 Phase 1）
 * @param userInput - 用户原始需求
 * @param registry - 工具注册表
 * @param monitor - 性能监控器
 * @param agentConfig - 合并后的 Agent 配置
 * @param onToolCall - 工具调用回调（用于 CLI 日志展示）
 * @returns LLM 的最终回复文本
 */
export async function executePlan(
  plan: StructuredPlan,
  userInput: string,
  registry: ToolRegistry,
  monitor: ToolMonitor,
  agentConfig: AgentConfig,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<string> {
  // 根据策略筛选工具（v4.7: 优先使用会话级注册表）
  const effectiveRegistry = agentConfig.sessionRegistry || registry;
  const tools =
    agentConfig.toolSelectionStrategy === "all"
      ? effectiveRegistry.getSchemas()
      : effectiveRegistry.getSchemasByToolboxes(plan.requiredToolboxes);

  // 初始化执行上下文（v4.7: 使用会话级工作空间）
  const sessionWorkspace = agentConfig.sessionWorkspace;
  const ctx: ToolContext = {
    cwd: sessionWorkspace || getDefaultWorkspace(),
    allowedPaths: [sessionWorkspace || getDefaultWorkspace()],
    permission: "allowlist",
  };

  // 初始化循环检测器（v4.1）
  const loopConfig = agentConfig.loopDetection ?? DEFAULT_LOOP_DETECTION;
  const loopDetector = new LoopDetector(loopConfig);

  // v4.6: 使用上下文管理器替代原始 messages 数组
  const modelConfig = getDefaultModelConfig();
  const contextManager = new DefaultContextManager(
    modelConfig.contextWindow,
    agentConfig.contextCompressThreshold,
    tools,
  );

  // 构建 system prompt
  let systemPrompt = `你是一个有用的助手。${plan.summary}`;

  // v4.6: 三层记忆注入
  // Layer 2: 会话记忆（同聊天室的长期记忆）
  // Layer 3: 语义检索（跨所有会话的相关记忆）
  if (agentConfig.sessionKey) {
    const memory = await memoryStore.load(agentConfig.sessionKey);

    // Layer 3: 语义检索相关记忆
    const relevantMemories = searchRelevantMemory(userInput, 8, 0);
    const searchResults = formatSearchResults(relevantMemories);
    if (searchResults) {
      systemPrompt += `\n\n${searchResults}`;
      if (agentConfig.debug) {
        console.log(`🔍 Layer 3 语义检索: ${relevantMemories.length} 条相关记忆`);
      }
    }

    if (memory) {
      contextManager.init(systemPrompt, userInput);
      contextManager.injectMemory(memory);
    } else {
      contextManager.init(systemPrompt, userInput);
    }
  } else {
    contextManager.init(systemPrompt, userInput);
  }

  // v4.9.3: 恢复上一轮对话历史
  if (agentConfig.conversationHistory?.length) {
    contextManager.appendHistory(agentConfig.conversationHistory);
    if (agentConfig.debug) {
      console.log(`📜 恢复对话历史: ${agentConfig.conversationHistory.length} 条消息`);
    }
  }

  const maxTurns = agentConfig.maxTurns;
  let turns = maxTurns;
  let loopWarningShown = false;

  // v4.6: 跟踪工具调用和回复，用于会话结束后保存记忆
  const turnToolCalls: Array<{ name: string; args: string; result?: string }> = [];
  let finalReply = "";

  // 调试日志
  if (agentConfig.debug) {
    console.log(`\n🔧 使用 ${tools.length} 个工具 (策略: ${agentConfig.toolSelectionStrategy})`);
    console.log(`📊 计划: ${plan.summary}`);
    console.log(`🔄 最大轮数: ${maxTurns} | 循环检测: ${loopConfig.enabled ? "启用" : "禁用"}`);
    console.log(`📦 上下文窗口: ${modelConfig.contextWindow} tokens | 压缩阈值: ${(agentConfig.contextCompressThreshold * 100).toFixed(0)}%`);
    const indexStats = getIndexStats();
    console.log(`🧠 三层记忆: L1(上下文) | L2(会话文件) | L3(关键词索引) ${indexStats.totalKeywords} 词 / ${indexStats.totalReferences} 条引用`);
  }

  // ── ReAct 循环 ──
  while (turns-- > 0) {
    const startMs = Date.now();
    const messages = contextManager.getMessages();

    if (agentConfig.debug) {
      console.log(`\n📨 LLM 请求 (第 ${maxTurns - turns} 轮):`);
      console.log(`  消息数: ${messages.length}`);
      console.log(`  工具数: ${tools.length}`);
    }

    // 调用 LLM
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
    });

    const msg = response.choices[0].message;

    // 增量日志
    if (agentConfig.logFile) {
      appendLog(agentConfig.logFile, {
        phase: "exec",
        turn: maxTurns - turns,
        req: {
          model: MODEL,
          messageCount: messages.length,
          toolCount: tools.length,
          lastMessage: messages[messages.length - 1]
            ? {
                role: messages[messages.length - 1].role,
                content: truncate(messages[messages.length - 1].content ?? "[tool_calls]", 500),
              }
            : null,
        },
        res: {
          hasToolCalls: !!msg.tool_calls?.length,
          toolCalls:
            msg.tool_calls?.map(tc => ({
              name: tc.function.name,
              args: truncate(tc.function.arguments, 300),
            })) ?? null,
          content: msg.content ? truncate(msg.content, 1000) : null,
          usage: response.usage,
        },
      });
    }

    // 没有工具调用 → LLM 给出了最终回复
    if (!msg.tool_calls?.length) {
      finalReply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);
      contextManager.append(msg);

      // v4.6: 保存会话记忆
      if (agentConfig.sessionKey && finalReply) {
        await saveSessionMemory(agentConfig.sessionKey, userInput, finalReply, turnToolCalls);
      }

      if (agentConfig.debug) {
        console.log(contextManager.getTokenReport());
      }

      return finalReply;
    }

    // 追加 LLM 回复到上下文
    contextManager.append(msg);

    // ── 按顺序执行每个工具调用 ──
    for (const tc of msg.tool_calls) {
      const tool = registry.get(tc.function.name);
      if (!tool) {
        contextManager.append({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用: ${registry.list().join(", ")}`,
        });
        onToolCall?.(tc.function.name, tc.function.arguments, "⚠️ 未知工具");
        continue;
      }

      // ── 循环检测 ──
      try {
        const args = JSON.parse(tc.function.arguments);
        const loopCheck = loopDetector.check(tc.function.name, args);

        if (loopCheck.level === "critical") {
          monitor.record(tc.function.name, Date.now() - startMs, false);
          const errorMsg = `🛑 循环检测拦截: ${loopCheck.message}`;
          if (agentConfig.outputManager) {
            agentConfig.outputManager.write(errorMsg);
          } else {
            console.error(errorMsg);
          }
          return `⚠️ 任务执行被终止：${loopCheck.message}\n\n建议：简化请求或明确具体目标。`;
        }

        if (loopCheck.level === "warning" && !loopWarningShown) {
          loopWarningShown = true;
          const warnMsg = loopCheck.message;
          if (agentConfig.outputManager) {
            agentConfig.outputManager.write(warnMsg);
          } else {
            console.warn(warnMsg);
          }
        }
      } catch {
        // 解析失败，跳过检测继续执行
      }

      // 执行工具
      const toolStart = Date.now();
      let result;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await tool.handler(args, ctx);
        turnToolCalls.push({
          name: tc.function.name,
          args: tc.function.arguments,
          result: result.content,
        });
        loopDetector.record(tc.function.name, args, result.content);
      } catch (err: unknown) {
        result = {
          success: false,
          content: `⚠️ 执行异常: ${err instanceof Error ? err.message : String(err)}`,
        };
        turnToolCalls.push({ name: tc.function.name, args: tc.function.arguments });
      }

      monitor.record(tc.function.name, Date.now() - toolStart, result.success);
      contextManager.append({
        role: "tool",
        tool_call_id: tc.id,
        content: result.content,
      });
      onToolCall?.(tc.function.name, tc.function.arguments, result.content);
    }
  }

  // 达到最大轮数
  const loopStats = loopDetector.getStats();

  // v4.6: 保存会话记忆（即使未完成任务）
  if (agentConfig.sessionKey) {
    await saveSessionMemory(agentConfig.sessionKey, userInput, "达到最大轮数，任务未完成", turnToolCalls);
  }

  if (agentConfig.debug) {
    console.log(contextManager.getTokenReport());
  }

  return `⚠️ 达到最大调用次数（${maxTurns} 轮），任务未完成。\n\n建议：\n- 简化请求，分步骤执行\n- 明确具体目标\n- 检查是否存在重复操作模式\n\n📊 本轮统计：工具调用 ${loopStats.totalCalls} 次`;
}

/**
 * 保存会话记忆（抽取为独立函数，避免重复代码）
 *
 * 在一轮对话结束时调用，提取关键事实、生成摘要，
 * 并添加到记忆存储和关键词索引中。
 *
 * @param sessionKey - 会话标识（如 "feishu:chat_123"）
 * @param userInput - 用户输入
 * @param finalReply - Agent 的最终回复
 * @param turnToolCalls - 本轮使用的工具调用列表
 * @returns 无返回值
 */
async function saveSessionMemory(
  sessionKey: string,
  userInput: string,
  finalReply: string,
  turnToolCalls: Array<{ name: string; args: string; result?: string }>,
): Promise<void> {
  const facts = extractFacts(userInput + " " + finalReply);
  const summary = generateTurnSummary(userInput, turnToolCalls, finalReply);
  const now = new Date().toISOString();
  await memoryStore.updateSummary(sessionKey, summary, facts);
  await memoryStore.addEntry(sessionKey, {
    timestamp: now,
    userSnippet: userInput.slice(0, 100),
    summary,
    facts,
  });
}
