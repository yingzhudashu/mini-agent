/**
 * Enhanced ReAct agent loop with tool registry, monitoring, and pipeline support.
 */
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  ToolRegistry,
  ToolMonitor,
  AgentOptions,
  ToolContext,
  PipelineResult,
  PipelineStep,
} from "./types.js";
import { DefaultToolMonitor } from "./monitor.js";
import { getDefaultWorkspace } from "../security/sandbox.js";

// ── LLM Client ──
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Execute a pipeline of tool calls sequentially.
 * Each step's result is available for the next step via context.
 */
async function executePipeline(
  steps: PipelineStep[],
  registry: ToolRegistry,
  ctx: ToolContext,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<PipelineResult> {
  const results: PipelineResult["steps"] = [];
  let pipelineContent = "";

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

/**
 * Core ReAct agent loop.
 *
 * Supports:
 * - Standard tool calling via LLM
 * - Pipeline mode for sequential tool execution
 * - Performance monitoring
 * - Configurable system prompt and max turns
 */
export async function runAgent(
  userInput: string,
  options: {
    registry: ToolRegistry;
    monitor?: ToolMonitor;
    context?: ToolContext;
    systemPrompt?: string;
    maxTurns?: number;
    onToolCall?: (name: string, args: string, result: string) => void;
  },
): Promise<string> {
  const { registry, monitor = new DefaultToolMonitor() } = options;
  const systemPrompt = options.systemPrompt ?? "你是一个有用的助手。";
  const maxTurns = options.maxTurns ?? 5;
  const onToolCall = options.onToolCall ?? ((n, a, r) => console.log(`[工具] ${n}(${a}) → ${r}`));

  const workspace = getDefaultWorkspace();
  const ctx: ToolContext = options.context ?? {
    cwd: workspace,
    allowedPaths: [workspace],
    permission: "allowlist",
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  let turns = maxTurns;

  while (turns-- > 0) {
    const startMs = Date.now();

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: registry.getSchemas(),
    });

    const msg = response.choices[0].message;

    // No tool calls — return final response
    if (!msg.tool_calls?.length) {
      const reply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);
      return reply;
    }

    // Execute tool calls
    messages.push(msg);

    for (const tc of msg.tool_calls) {
      const tool = registry.get(tc.function.name);

      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用工具: ${registry.list().join(", ")}`,
        });
        onToolCall(tc.function.name, tc.function.arguments, "❌ 未知工具");
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

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.content,
      });

      onToolCall(tc.function.name, tc.function.arguments, result.content);
    }
  }

  return "⚠️ 达到最大调用次数，请简化请求";
}

/**
 * Pipeline runner — execute a sequence of tools without LLM.
 * Useful for deterministic workflows.
 */
export async function runPipeline(
  steps: PipelineStep[],
  registry: ToolRegistry,
  context?: ToolContext,
  onToolCall?: (name: string, args: string, result: string) => void,
): Promise<PipelineResult> {
  const workspace = getDefaultWorkspace();
  const ctx = context ?? {
    cwd: workspace,
    allowedPaths: [workspace],
    permission: "allowlist",
  };

  return executePipeline(steps, registry, ctx, onToolCall);
}
