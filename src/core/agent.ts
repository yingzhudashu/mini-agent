/**
 * @file agent.ts — Agent 核心运行逻辑
 * @description
 *   这是 Mini Agent v4 的大脑，实现了两阶段架构。
 *
 *   ┌───────────────────────────────────────────────────┐
 *   │  Phase 1: Planning（规划阶段）                      │
 *   │                                                   │
 *   │  输入: 用户需求 + 可用工具箱描述                     │
 *   │  过程: LLM 分析需求，生成结构化执行计划               │
 *   │  输出: StructuredPlan（步骤、工具箱、配置、预估）      │
 *   │                                                   │
 *   │  关键决策：                                         │
 *   │  - Lazy import planner.js 避免循环依赖               │
 *   │  - 规划失败 3 次重试 → 降级为直接执行模式              │
 *   │  - 高风险操作需要用户确认（onPlan 回调）               │
 *   └──────────────────────┬────────────────────────────┘
 *                          │
 *   ┌──────────────────────▼────────────────────────────┐
 *   │  Phase 2: Execution（执行阶段）                     │
 *   │                                                   │
 *   │  输入: StructuredPlan + 用户需求                     │
 *   │  过程: ReAct 循环（思考 → 工具调用 → 执行 → 反馈）     │
 *   │  输出: 最终回复                                      │
 *   │                                                   │
 *   │  v4.1 新增机制：                                    │
 *   │  - 循环检测（LoopDetector）：防止无限循环             │
 *   │  - 上下文压缩：消息过长时自动摘要历史                  │
 *   └───────────────────────────────────────────────────┘
 *
 *   工具筛选策略：
 *   - "all"     → 发送全部工具
 *   - "toolbox" → 只发送 plan.requiredToolboxes 的工具
 *   - "auto"    → 预留，未来可用语义匹配
 *
 *   配置合并优先级（从低到高）：
 *   1. getDefaultAgentConfig() — 默认值
 *   2. runAgent(options.agentConfig) — 用户显式传入
 *   3. plan.suggestedConfig — 规划器推荐（最高优先级）
 *
 *   导出项：
 *   - client: 共享的 OpenAI 客户端实例
 *   - MODEL: 当前使用的模型名称
 *   - runAgent(): 两阶段主入口
 *   - runPipeline(): 线性管线执行器（无 LLM 循环）
 *
 * @module core/agent
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  ToolRegistry,
  ToolMonitor,
  ToolContext,
  PipelineResult,
  PipelineStep,
  StructuredPlan,
  Toolbox,
  AgentConfig,
} from "./types.js";
import { DefaultToolMonitor } from "./monitor.js";
import { getDefaultWorkspace } from "../security/sandbox.js";
import { getDefaultModelConfig, getDefaultAgentConfig, mergeAgentConfig } from "./config.js";
import { appendLog, truncate } from "./logger.js";
import { LoopDetector } from "./loop-detector.js";
import { DEFAULT_LOOP_DETECTION } from "./config.js";
// v4.6: 上下文管理与记忆
import { DefaultContextManager } from "./context-manager.js";
import { memoryStore, extractFacts, generateTurnSummary } from "./memory-store.js";
import { loadIndex, searchRelevantMemory, formatSearchResults, getIndexStats } from "./keyword-index.js";
import { getSessionManager } from "./session-manager.js";

// ============================================================================
// OpenAI 客户端
// ============================================================================

/**
 * 全局共享的 OpenAI 客户端实例
 *
 * 从环境变量读取 API 密钥和端点：
 * - OPENAI_API_KEY: API 密钥
 * - OPENAI_BASE_URL: API 端点（如 DashScope 的 https://coding.dashscope.aliyuncs.com/v1）
 *
 * 注意：planner.ts 使用独立的 client 实例以避免循环依赖。
 */
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

/**
 * 当前使用的模型名称
 *
 * 从环境变量 OPENAI_MODEL 读取，默认为 "gpt-4o-mini"。
 */
export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================================
// Phase 2: 执行阶段
// ============================================================================

/**
 * 执行结构化计划（ReAct 循环）
 *
 * 这是 Agent 的核心执行逻辑。工作流程：
 *
 * ```
 * 1. 根据 plan.requiredToolboxes 筛选工具（toolSelectionStrategy 控制策略）
 * 2. 初始化循环检测器（v4.1 新增）
 * 3. 初始化消息列表：system prompt + 用户输入
 * 4. 进入 ReAct 循环：
 *    a. 循环检测：检查是否陷入重复模式
 *    b. 发送消息 + 工具 schema 给 LLM
 *    c. LLM 回复：
 *       - 纯文本 → 最终回复，循环结束
 *       - 工具调用 → 执行工具，将结果追加到消息
 *    d. 上下文管理：消息过长时压缩历史
 *    e. 循环直到：LLM 不再调用工具，或达到 maxTurns，或被循环检测拦截
 * 5. 返回最终回复
 * ```
 *
 * 工具调用处理：
 * - 支持并行工具调用（LLM 一次返回多个 tool_calls）
 * - 按顺序执行每个工具（目前不支持真正的并行执行）
 * - 未知工具返回错误信息，不中断循环
 * - 工具执行异常被捕获为失败结果，不抛出
 *
 * v4.1 新增：
 * - 循环检测：genericRepeat + knownPollNoProgress + pingPong
 * - 上下文压缩：消息超过 12 条时自动摘要中间历史
 *
 * @param plan - 结构化执行计划（来自 Phase 1）
 * @param userInput - 用户原始需求
 * @param registry - 工具注册表
 * @param monitor - 性能监控器
 * @param agentConfig - 合并后的 Agent 配置
 * @param onToolCall - 工具调用回调（用于 CLI 日志展示）
 * @returns LLM 的最终回复文本
 */
async function executePlan(
  plan: StructuredPlan,
  userInput: string,
  registry: ToolRegistry,
  monitor: ToolMonitor,
  agentConfig: AgentConfig,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<string> {
  // 根据策略筛选工具
  // v4.7: 优先使用会话级注册表
  const effectiveRegistry = agentConfig.sessionRegistry || registry;
  const tools = agentConfig.toolSelectionStrategy === "all"
    ? effectiveRegistry.getSchemas()
    : effectiveRegistry.getSchemasByToolboxes(plan.requiredToolboxes);

  // 初始化执行上下文
  // v4.7: 使用会话级工作空间
  const sessionWorkspace = agentConfig.sessionWorkspace;
  const ctx: ToolContext = {
    cwd: sessionWorkspace || getDefaultWorkspace(),
    allowedPaths: [sessionWorkspace || getDefaultWorkspace()],
    permission: "allowlist",
  };

  // 初始化循环检测器（v4.1 新增，参考 OpenClaw 的 loop-detection）
  const loopConfig = agentConfig.loopDetection ?? DEFAULT_LOOP_DETECTION;
  const loopDetector = new LoopDetector(loopConfig);

  // v4.6: 使用上下文管理器替代原始的 messages 数组
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
    // v4.6: 三层记忆状态
    const indexStats = getIndexStats();
    console.log(`🧠 三层记忆: L1(上下文) | L2(会话文件) | L3(关键词索引 ${indexStats.totalKeywords} 词 / ${indexStats.totalReferences} 条引用)`);
  }

  // ── ReAct 循环 ──
  // 每次循环 = 一次 LLM 调用 + 可能的工具调用
  while (turns-- > 0) {
    const startMs = Date.now();

    // v4.6: 使用上下文管理器获取消息列表
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
            ? { role: messages[messages.length - 1].role, content: truncate(messages[messages.length - 1].content ?? "[tool_calls]", 500) }
            : null,
        },
        res: {
          hasToolCalls: !!msg.tool_calls?.length,
          toolCalls: msg.tool_calls?.map(tc => ({ name: tc.function.name, args: truncate(tc.function.arguments, 300) })) ?? null,
          content: msg.content ? truncate(msg.content, 1000) : null,
          usage: response.usage,
        },
      });
    }

    // 没有工具调用 → LLM 给出了最终回复
    if (!msg.tool_calls?.length) {
      finalReply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);

      // v4.6: 追加到上下文管理器
      contextManager.append(msg);

      // v4.6: 保存会话记忆
      if (agentConfig.sessionKey && finalReply) {
        const facts = extractFacts(userInput + " " + finalReply);
        const summary = generateTurnSummary(userInput, turnToolCalls, finalReply);
        const now = new Date().toISOString();
        await memoryStore.updateSummary(agentConfig.sessionKey, summary, facts);
        await memoryStore.addEntry(agentConfig.sessionKey, {
          timestamp: now,
          userSnippet: userInput.slice(0, 100),
          summary,
          facts,
        });
        if (agentConfig.debug) {
          console.log(`💾 记忆已保存 [${agentConfig.sessionKey}]`);
          console.log(`   提取事实: ${facts.length > 0 ? facts.join("; ") : "无"}`);
        }
      }

      if (agentConfig.debug) {
        console.log(contextManager.getTokenReport());
      }

      return finalReply;
    }

    // v4.6: 使用上下文管理器追加 LLM 回复
    contextManager.append(msg);

    // ── 按顺序执行每个工具调用 ──
    for (const tc of msg.tool_calls) {
      const tool = registry.get(tc.function.name);
      if (!tool) {
        // 未知工具：返回错误信息，让 LLM 自我纠正
        contextManager.append({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用: ${registry.list().join(", ")}`,
        });
        onToolCall?.(tc.function.name, tc.function.arguments, "❌ 未知工具");
        continue;
      }

      // ── 循环检测：在执行前检查是否陷入循环 ──
      try {
        const args = JSON.parse(tc.function.arguments);
        const loopCheck = loopDetector.check(tc.function.name, args);

        if (loopCheck.level === "critical") {
          // 强制终止：避免无限循环
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
          // 警告：通知用户但不拦截
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

        // v4.6: 记录工具调用，用于记忆保存
        turnToolCalls.push({ name: tc.function.name, args: tc.function.arguments, result: result.content });

        // 记录到循环检测器
        loopDetector.record(tc.function.name, args, result.content);
      } catch (err: any) {
        // 执行异常：不抛出，而是作为失败结果返回给 LLM
        result = { success: false, content: `❌ 执行异常: ${err?.message ?? err}` };
        turnToolCalls.push({ name: tc.function.name, args: tc.function.arguments });
      }

      // 记录性能数据
      monitor.record(tc.function.name, Date.now() - toolStart, result.success);

      // v4.6: 使用上下文管理器追加工具结果（自动触发压缩）
      contextManager.append({ role: "tool", tool_call_id: tc.id, content: result.content });

      // 回调通知（用于 CLI 日志展示）
      onToolCall?.(tc.function.name, tc.function.arguments, result.content);
    }
  }

  // 达到最大轮数 → 提供有用的反馈
  const loopStats = loopDetector.getStats();

  // v4.6: 保存会话记忆（即使未完成任务）
  if (agentConfig.sessionKey) {
    const facts = extractFacts(userInput);
    const summary = generateTurnSummary(userInput, turnToolCalls, "达到最大轮数，任务未完成");
    const now = new Date().toISOString();
    await memoryStore.updateSummary(agentConfig.sessionKey, summary, facts);
    await memoryStore.addEntry(agentConfig.sessionKey, {
      timestamp: now,
      userSnippet: userInput.slice(0, 100),
      summary,
      facts,
    });
  }

  if (agentConfig.debug) {
    console.log(contextManager.getTokenReport());
  }

  return `⚠️ 达到最大调用次数（${maxTurns} 轮），任务未完成。\n\n建议：\n- 简化请求，分步骤执行\n- 明确具体目标\n- 检查是否存在重复操作模式\n\n📊 本轮统计：工具调用 ${loopStats.totalCalls} 次`;
}

// ============================================================================
// 主入口：两阶段 Agent
// ============================================================================

/**
 * 运行 Agent（两阶段模式）
 *
 * 这是外部调用的主入口，实现了完整的两阶段流程：
 *
 * **Phase 1: Planning（规划阶段）**
 * - 分析用户需求 + 可用工具箱
 * - LLM 生成结构化执行计划
 * - 高风险操作可要求用户确认
 *
 * **Phase 2: Execution（执行阶段）**
 * - 根据计划的工具箱筛选工具
 * - 运行 ReAct 循环（含循环检测和上下文压缩）
 *
 * **跳过规划模式：**
 * - 设置 skipPlanning=true 或使用 `.plan <内容>` 命令
 * - 适用于简单问答、已确认安全的操作
 *
 * @param userInput - 用户的原始需求
 * @param options - 运行选项
 * @param options.registry - 工具注册表（必需）
 * @param options.monitor - 性能监控器（可选，默认创建）
 * @param options.toolboxes - 可用工具箱列表（可选，空则跳过规划）
 * @param options.agentConfig - Agent 配置覆盖（可选）
 * @param options.systemPrompt - 自定义系统提示词（可选）
 * @param options.skipPlanning - 跳过规划阶段直接执行（可选）
 * @param options.onToolCall - 工具调用回调（可选）
 * @param options.onPlan - 计划确认回调（可选，返回 true 批准执行）
 * @returns Agent 的最终回复文本
 *
 * @example
 *   const reply = await runAgent("帮我创建一个 Hello World 文件", {
 *     registry,
 *     monitor,
 *     toolboxes: DEFAULT_TOOLBOXES,
 *     onToolCall: (name, args, result) => console.log(`${name} → ${result}`),
 *   });
 */
export async function runAgent(
  userInput: string,
  options: {
    registry: ToolRegistry;
    monitor?: ToolMonitor;
    toolboxes?: Toolbox[];
    agentConfig?: Partial<AgentConfig>;
    systemPrompt?: string;
    skipPlanning?: boolean;
    onToolCall?: (name: string, args: string, result: string) => void;
    onPlan?: (plan: StructuredPlan) => Promise<boolean>;  // returns true to approve
  },
): Promise<string> {
  const {
    registry,
    monitor = new DefaultToolMonitor(),
    toolboxes = [],
    skipPlanning = false,
    onToolCall,
    onPlan,
  } = options;

  // ── 合并配置（确保所有默认值正确） ──
  const baseConfig = getDefaultAgentConfig();
  const agentConfig = mergeAgentConfig(baseConfig, options.agentConfig ?? {});

  let plan: StructuredPlan;

  // ── 直接执行模式 ──
  // 当 skipPlanning=true 或没有提供工具箱时，跳过规划阶段
  if (skipPlanning || toolboxes.length === 0) {
    plan = {
      summary: "直接执行模式",
      steps: [],
      requiredToolboxes: [],
      suggestedConfig: { maxTurns: 5, toolTimeout: 30, riskLevel: "low" },
      estimatedTokens: { promptTokens: 0, completionTokens: 0, toolResultTokens: 0, total: 0 },
      contextStrategy: { mode: "normal", reason: "跳过规划" },
      requiresConfirmation: false,
      riskLevel: "low",
      estimatedCost: { inputTokens: 0, outputTokens: 0, totalUSD: 0 },
      outputSpec: { language: "zh-CN", format: "markdown", expectedDeliverable: "" },
      fallbackPlan: { degradeToSimple: false, degradedMaxTurns: 5 },
    };
  } else {
    // ── Phase 1: 规划阶段 ──
    // Lazy import 避免循环依赖
    const { generatePlan } = await import("./planner.js");
    const logFile = agentConfig.logFile;
    plan = await generatePlan(userInput, toolboxes, logFile);

    // 合并规划器的建议配置
    Object.assign(agentConfig, mergeAgentConfig(agentConfig, plan.suggestedConfig));

    // 调试日志
    if (agentConfig.debug) {
      console.log("\n📋 规划结果:");
      console.log(`  摘要: ${plan.summary}`);
      console.log(`  工具箱: ${plan.requiredToolboxes.join(", ")}`);
      console.log(`  预估 token: ${plan.estimatedTokens.total}`);
      console.log(`  风险: ${plan.riskLevel}`);
    }

    // 高风险操作需要用户确认
    if (plan.requiresConfirmation && onPlan) {
      const approved = await onPlan(plan);
      if (!approved) return "❌ 操作已取消";
    }
  }

  // ── Phase 2: 执行 ──
  return executePlan(plan, userInput, registry, monitor, agentConfig, onToolCall);
}

// ============================================================================
// 管线执行器（无 LLM 循环的线性执行）
// ============================================================================

/**
 * 运行管线（线性工具执行器）
 *
 * 与 runAgent() 的区别：
 * - runAgent(): ReAct 循环，LLM 自主决定工具调用顺序
 * - runPipeline(): 线性执行，预先定义好工具调用序列
 *
 * 适用场景：
 * - 预定义的自动化流程（如 CI/CD 脚本）
 * - 确定性操作（不需要 LLM 判断）
 * - 批量文件处理
 *
 * 执行流程：
 * 1. 按顺序遍历每个 PipelineStep
 * 2. 查找工具 → 执行 → 收集结果
 * 3. 任意步骤失败立即返回
 * 4. 全部成功返回累积内容
 *
 * @param steps - 预定义的工具调用序列
 * @param registry - 工具注册表
 * @param context - 执行上下文（可选）
 * @param onToolCall - 工具调用回调（可选）
 * @returns 管线执行结果
 */
export async function runPipeline(
  steps: PipelineStep[],
  registry: ToolRegistry,
  context?: ToolContext,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<PipelineResult> {
  const results: PipelineResult["steps"] = [];
  let pipelineContent = "";
  const ctx = context ?? {
    cwd: getDefaultWorkspace(),
    allowedPaths: [getDefaultWorkspace()],
    permission: "allowlist",
  };

  for (const step of steps) {
    const tool = registry.get(step.tool);
    if (!tool) {
      const err = { success: false, content: `❌ 未知工具: ${step.tool}` };
      results.push({ tool: step.tool, args: step.args, result: err });
      return { steps: results, finalContent: err.content, success: false };
    }
    const result = await tool.handler(step.args, ctx);
    results.push({ tool: step.tool, args: step.args, result });
    pipelineContent += result.content + "\n";
    onToolCall?.(step.tool, JSON.stringify(step.args), result.content);
  }

  return { steps: results, finalContent: pipelineContent.trim(), success: true };
}

// v4.7: 导出 SessionManager
export { getSessionManager } from "./session-manager.js";
