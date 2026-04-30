/**
 * @file agent.ts — Agent 核心运行逻辑
 * @description
 *   这是 Mini Agent v3 的大脑，实现了两阶段架构。
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
 *   │  工具筛选策略：                                      │
 *   │  - "all"     → 发送全部工具                          │
 *   │  - "toolbox" → 只发送 plan.requiredToolboxes 的工具   │
 *   │  - "auto"    → 预留，未来可用语义匹配                 │
 *   └───────────────────────────────────────────────────┘
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

/** 当前使用的模型名称，从环境变量读取，默认 gpt-4o-mini */
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
 * 2. 初始化消息列表：system prompt + 用户输入
 * 3. 进入 ReAct 循环：
 *    a. 发送消息 + 工具 schema 给 LLM
 *    b. LLM 回复：
 *       - 纯文本 → 最终回复，循环结束
 *       - 工具调用 → 执行工具，将结果追加到消息
 *    c. 循环直到：LLM 不再调用工具，或达到 maxTurns
 * 4. 返回最终回复
 * ```
 *
 * 工具调用处理：
 * - 支持并行工具调用（LLM 一次返回多个 tool_calls）
 * - 按顺序执行每个工具（目前不支持真正的并行执行）
 * - 未知工具返回错误信息，不中断循环
 * - 工具执行异常被捕获为失败结果，不抛出
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
  const tools = agentConfig.toolSelectionStrategy === "all"
    ? registry.getSchemas()
    : registry.getSchemasByToolboxes(plan.requiredToolboxes);

  // 初始化执行上下文
  const ctx: ToolContext = {
    cwd: getDefaultWorkspace(),
    allowedPaths: [getDefaultWorkspace()],
    permission: "allowlist",
  };

  // 初始化消息列表
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `你是一个有用的助手。${plan.summary}` },
    { role: "user", content: userInput },
  ];

  const maxTurns = agentConfig.maxTurns;
  let turns = maxTurns;

  // 调试日志：显示当前使用的工具数和计划信息
  if (agentConfig.debug) {
    console.log(`\n🔧 使用 ${tools.length} 个工具 (策略: ${agentConfig.toolSelectionStrategy})`);
    console.log(`📊 计划: ${plan.summary}`);
    console.log(`🔄 最大轮数: ${maxTurns}`);
  }

  // ReAct 循环
  // 每次循环 = 一次 LLM 调用 + 可能的工具调用
  while (turns-- > 0) {
    const startMs = Date.now();

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

    // 没有工具调用 → LLM 给出了最终回复
    if (!msg.tool_calls?.length) {
      const reply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);
      return reply;
    }

    // 将 LLM 回复（包含 tool_calls）追加到消息历史
    messages.push(msg);

    // 按顺序执行每个工具调用
    for (const tc of msg.tool_calls) {
      const tool = registry.get(tc.function.name);
      if (!tool) {
        // 未知工具：返回错误信息，让 LLM 自我纠正
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用: ${registry.list().join(", ")}`,
        });
        onToolCall?.(tc.function.name, tc.function.arguments, "❌ 未知工具");
        continue;
      }

      // 执行工具
      const toolStart = Date.now();
      let result;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await tool.handler(args, ctx);
      } catch (err: any) {
        // 执行异常：不抛出，而是作为失败结果返回给 LLM
        result = { success: false, content: `❌ 执行异常: ${err?.message ?? err}` };
      }

      // 记录性能数据
      monitor.record(tc.function.name, Date.now() - toolStart, result.success);

      // 将工具结果追加到消息历史
      messages.push({ role: "tool", tool_call_id: tc.id, content: result.content });

      // 回调通知（用于 CLI 日志展示）
      onToolCall?.(tc.function.name, tc.function.arguments, result.content);
    }
  }

  // 达到最大轮数 → 提示用户简化请求
  return "⚠️ 达到最大调用次数，请简化请求";
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
 * - 运行 ReAct 循环
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
    // Lazy import 避免循环依赖（planner.js → agent.js → planner.js）
    const { generatePlan } = await import("./planner.js");
    plan = await generatePlan(userInput, toolboxes);

    // 合并配置（用于调试日志和后续执行）
    const baseConfig = getDefaultAgentConfig();
    const agentConfig = mergeAgentConfig(baseConfig, {
      ...options.agentConfig,
      ...plan.suggestedConfig,
    });

    // 调试日志：显示规划结果
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

    // ── Phase 2: 执行阶段 ──
    return executePlan(plan, userInput, registry, monitor, agentConfig, onToolCall);
  }

  // 直接执行模式：合并配置
  const baseConfig = getDefaultAgentConfig();
  const agentConfig = mergeAgentConfig(baseConfig, {
    ...options.agentConfig,
    ...plan.suggestedConfig,
  });

  // Phase 2: 执行
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
