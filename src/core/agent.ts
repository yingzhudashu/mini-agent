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

// OpenAI client
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================================
// Plan execution
// ============================================================================

async function executePlan(
  plan: StructuredPlan,
  userInput: string,
  registry: ToolRegistry,
  monitor: ToolMonitor,
  agentConfig: AgentConfig,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<string> {
  const tools = agentConfig.toolSelectionStrategy === "all"
    ? registry.getSchemas()
    : registry.getSchemasByToolboxes(plan.requiredToolboxes);

  const ctx: ToolContext = {
    cwd: getDefaultWorkspace(),
    allowedPaths: [getDefaultWorkspace()],
    permission: "allowlist",
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `你是一个有用的助手。${plan.summary}` },
    { role: "user", content: userInput },
  ];

  const maxTurns = agentConfig.maxTurns;
  let turns = maxTurns;

  if (agentConfig.debug) {
    console.log(`\n🔧 使用 ${tools.length} 个工具 (策略: ${agentConfig.toolSelectionStrategy})`);
    console.log(`📊 计划: ${plan.summary}`);
    console.log(`🔄 最大轮数: ${maxTurns}`);
  }

  while (turns-- > 0) {
    const startMs = Date.now();

    if (agentConfig.debug) {
      console.log(`\n📨 LLM 请求 (第 ${maxTurns - turns} 轮):`);
      console.log(`  消息数: ${messages.length}`);
      console.log(`  工具数: ${tools.length}`);
    }

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
    });

    const msg = response.choices[0].message;

    if (!msg.tool_calls?.length) {
      const reply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);
      return reply;
    }

    messages.push(msg);

    for (const tc of msg.tool_calls) {
      const tool = registry.get(tc.function.name);
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用: ${registry.list().join(", ")}`,
        });
        onToolCall?.(tc.function.name, tc.function.arguments, "❌ 未知工具");
        continue;
      }

      const toolStart = Date.now();
      let result;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await tool.handler(args, ctx);
      } catch (err: any) {
        result = { success: false, content: `❌ 执行异常: ${err?.message ?? err}` };
      }

      monitor.record(tc.function.name, Date.now() - toolStart, result.success);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result.content });
      onToolCall?.(tc.function.name, tc.function.arguments, result.content);
    }
  }

  return "⚠️ 达到最大调用次数，请简化请求";
}

// ============================================================================
// Main entry (two-phase)
// ============================================================================

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

  if (skipPlanning || toolboxes.length === 0) {
    // Direct execution mode
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
    // Phase 1: Planning — lazy import to avoid circular dependency
    const { generatePlan } = await import("./planner.js");
    plan = await generatePlan(userInput, toolboxes);

    // Merge config first so we can use it for debug logging
    const baseConfig = getDefaultAgentConfig();
    const agentConfig = mergeAgentConfig(baseConfig, {
      ...options.agentConfig,
      ...plan.suggestedConfig,
    });

    if (agentConfig.debug) {
      console.log("\n📋 规划结果:");
      console.log(`  摘要: ${plan.summary}`);
      console.log(`  工具箱: ${plan.requiredToolboxes.join(", ")}`);
      console.log(`  预估 token: ${plan.estimatedTokens.total}`);
      console.log(`  风险: ${plan.riskLevel}`);
    }

    // Approval callback
    if (plan.requiresConfirmation && onPlan) {
      const approved = await onPlan(plan);
      if (!approved) return "❌ 操作已取消";
    }

    // Phase 2: Execution
    return executePlan(plan, userInput, registry, monitor, agentConfig, onToolCall);
  }

  // Merge config for direct execution mode
  const baseConfig = getDefaultAgentConfig();
  const agentConfig = mergeAgentConfig(baseConfig, {
    ...options.agentConfig,
    ...plan.suggestedConfig,
  });

  // Phase 2: Execution
  return executePlan(plan, userInput, registry, monitor, agentConfig, onToolCall);
}

// ============================================================================
// Pipeline
// ============================================================================

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
