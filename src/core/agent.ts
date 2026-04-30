/**
 * @file agent.ts — 增强版 ReAct Agent 核心循环
 * @description
 *   实现 ReAct（Reasoning + Acting）循环的完整逻辑：
 *   1. 接收用户输入
 *   2. 将输入发送给 LLM（附带工具 schema 列表）
 *   3. LLM 决定是直接回复还是调用工具
 *   4. 如果调用工具：执行工具 → 将结果发回 LLM → 重复步骤 2
 *   5. 如果直接回复：返回最终回复给用户
 *
 *   ReAct 循环流程：
 *   ```
 *   User Input → LLM → (有 tool_call?) ──是──→ 执行工具 → LLM → ...
 *                             │                       ↑
 *                             └─────────否────────────┘
 *                                                ↓
 *                                           返回回复
 *   ```
 *
 *   与 v1 的区别：
 *   - v1：工具硬编码在 agent.ts 内部，无法扩展
 *   - v2：工具通过 Registry 动态注册，Agent 核心与工具解耦
 *   - v2：加入 Performance Monitor，自动统计工具使用情况
 *   - v2：加入 ToolContext 参数，支持沙箱路径和权限控制
 *
 * @module core/agent
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

// ============================================================================
// LLM 客户端配置
// ============================================================================

/**
 * OpenAI 兼容客户端
 *
 * 从环境变量读取配置：
 * - OPENAI_API_KEY  — API 密钥
 * - OPENAI_BASE_URL — API 端点（支持 OpenAI、DashScope、SiliconFlow 等）
 *
 * 只要服务端遵循 OpenAI Chat Completions API 格式，就可以无缝切换后端。
 * 这就是 OpenAI 格式的行业标准价值。
 */
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

/**
 * 当前使用的模型名称
 *
 * 从环境变量读取，默认为 gpt-4o-mini。
 * 不同模型的工具调用能力差异很大：
 * - GPT-4o / Claude：工具调用准确率高
 * - Qwen 系列：性价比好，但参数格式有时需要调整
 * - 小模型：可能不会正确使用工具
 */
export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// ============================================================================
// 工具流水线
// ============================================================================

/**
 * 执行工具流水线
 *
 * 流水线模式：不经过 LLM，直接按顺序执行一系列工具调用。
 * 适用场景：
 * - 确定性的工作流（如 CI/CD 中的"构建 → 测试 → 部署"）
 * - 批量处理（如"读取 10 个文件并统计行数"）
 * - 需要精确控制执行顺序和错误处理的场景
 *
 * 与 ReAct 循环的区别：
 * - ReAct：LLM 决定调用哪个工具、何时调用
 * - 流水线：开发者显式指定工具调用序列
 *
 * 执行策略：
 * - 顺序执行：每一步等上一步完成后才执行
 * - 失败继续：即使某步失败，也会继续执行后续步骤
 * - 结果汇总：所有步骤的结果拼接成最终输出
 *
 * @param steps     - 工具调用序列，按顺序执行
 * @param registry  - 工具注册表，用于查找工具定义
 * @param ctx       - 执行上下文（工作目录、沙箱路径、权限）
 * @param onToolCall - 可选的工具调用回调，用于日志或 UI 更新
 * @returns 流水线执行结果，包含每一步的详情
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
    // 查找工具定义
    const tool = registry.get(step.tool);
    if (!tool) {
      const err = { success: false, content: `❌ 未知工具: ${step.tool}` };
      results.push({ tool: step.tool, args: step.args, result: err });
      return { steps: results, finalContent: err.content, success: false };
    }

    // 执行工具
    const result = await tool.handler(step.args, ctx);
    results.push({ tool: step.tool, args: step.args, result });
    pipelineContent += result.content + "\n";

    // 通知回调（如果提供了）
    onToolCall?.(step.tool, JSON.stringify(step.args), result.content);
  }

  return { steps: results, finalContent: pipelineContent.trim(), success: true };
}

// ============================================================================
// ReAct Agent 核心循环
// ============================================================================

/**
 * 核心 ReAct Agent 循环
 *
 * 这是整个 Agent 的大脑。工作原理：
 *
 * 1. 构建消息列表：[系统提示, 用户输入]
 * 2. 将消息和工具 schema 发送给 LLM
 * 3. LLM 的回复有两种情况：
 *    a. 纯文本回复（content 字段）→ 直接返回给用户
 *    b. 工具调用请求（tool_calls 字段）→ 执行工具，将结果追加到消息列表，回到步骤 2
 * 4. 重复步骤 2-3，直到 LLM 给出纯文本回复，或达到最大轮数
 *
 * 参数详解：
 * - userInput: 用户的自然语言输入
 * - options.registry: 工具注册表（必需），提供工具定义列表
 * - options.monitor: 性能监控器（可选），记录每次工具调用的耗时
 * - options.context: 执行上下文（可选），包含工作目录和沙箱路径
 * - options.systemPrompt: 系统提示词（可选），控制 LLM 的行为风格
 * - options.maxTurns: 最大循环轮数（可选），防止无限工具调用
 * - options.onToolCall: 工具调用回调（可选），用于日志或 UI 更新
 *
 * @example
 *   const reply = await runAgent("读取 package.json", {
 *     registry,
 *     monitor,
 *     systemPrompt: "你是一个文件助手，只回答文件相关问题",
 *     maxTurns: 3,
 *     onToolCall: (name, args, result) => {
 *       console.log(`[工具] ${name}:`, result);
 *     },
 *   });
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
  // ── 参数初始化 ──

  const { registry, monitor = new DefaultToolMonitor() } = options;
  // 默认系统提示：通用助手行为
  const systemPrompt = options.systemPrompt ?? "你是一个有用的助手。";
  // 默认最多 5 轮循环（每轮 = 一次 LLM 请求 + 可能的工具调用）
  const maxTurns = options.maxTurns ?? 5;
  // 默认工具调用回调：打印到控制台
  const onToolCall = options.onToolCall ?? ((n, a, r) => console.log(`[工具] ${n}(${a}) → ${r}`));

  // ── 构建执行上下文 ──

  const workspace = getDefaultWorkspace();
  const ctx: ToolContext = options.context ?? {
    cwd: workspace,                    // 当前工作目录
    allowedPaths: [workspace],         // 允许访问的目录（沙箱边界）
    permission: "allowlist",           // 默认权限级别
  };

  // ── 构建消息列表 ──

  /**
   * 消息列表是 ReAct 循环的"记忆"。
   * 每一轮 LLM 的回复和工具调用结果都会追加到这里，
   * 所以 LLM 可以看到之前的完整对话历史。
   *
   * 初始状态：
   * [
   *   { role: "system", content: "你是一个有用的助手。" },
   *   { role: "user",   content: "读取 package.json" },
   * ]
   *
   * 经过一轮工具调用后：
   * [
   *   { role: "system", content: "你是一个有用的助手。" },
   *   { role: "user",   content: "读取 package.json" },
   *   { role: "assistant", tool_calls: [...] },          ← LLM 的工具调用
   *   { role: "tool",     tool_call_id: "...", content: "文件内容" }, ← 工具执行结果
   * ]
   */
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  // ── ReAct 循环 ──

  let turns = maxTurns;

  while (turns-- > 0) {
    // 记录本轮 LLM 请求的开始时间
    const startMs = Date.now();

    // 发送请求给 LLM
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: registry.getSchemas(),  // 将注册的所有工具 schema 传给 LLM
    });

    const msg = response.choices[0].message;

    // ── 情况 A：LLM 直接回复（无工具调用） ──
    // 这是循环的终止条件，说明 LLM 已经有了最终答案
    if (!msg.tool_calls?.length) {
      const reply = msg.content || "(空回复)";
      monitor.record("llm_response", Date.now() - startMs, true);
      return reply;
    }

    // ── 情况 B：LLM 请求调用工具 ──
    // 将 LLM 的回复（包含 tool_calls）追加到消息列表
    messages.push(msg);

    // 逐个执行工具调用
    for (const tc of msg.tool_calls) {
      // 从注册表中查找工具定义
      const tool = registry.get(tc.function.name);

      // 如果工具不存在，构造错误信息返回给 LLM
      // LLM 会尝试用其他方式继续或告知用户
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}。可用工具: ${registry.list().join(", ")}`,
        });
        onToolCall(tc.function.name, tc.function.arguments, "❌ 未知工具");
        continue;
      }

      // ── 执行工具 ──
      const toolStart = Date.now();
      let result;

      try {
        // 解析 LLM 生成的 JSON 参数
        const args = JSON.parse(tc.function.arguments);
        // 调用工具的 handler，传入参数和上下文
        result = await tool.handler(args, ctx);
      } catch (err: any) {
        // 捕获执行异常（如网络错误、文件不存在等）
        result = { success: false, content: `❌ 执行异常: ${err?.message ?? err}` };
      }

      // 记录工具调用的性能数据
      monitor.record(tc.function.name, Date.now() - toolStart, result.success);

      // 将工具执行结果追加到消息列表
      // LLM 将在下一轮看到这个结果并据此生成最终回复
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.content,
      });

      // 通知回调
      onToolCall(tc.function.name, tc.function.arguments, result.content);
    }
  }

  // ── 循环耗尽 ──
  // 如果达到最大轮数还没得到纯文本回复，说明请求太复杂或 LLM 在循环
  return "⚠️ 达到最大调用次数，请简化请求";
}

// ============================================================================
// 流水线运行器（非 LLM 模式）
// ============================================================================

/**
 * 流水线运行器 — 不经过 LLM 直接顺序执行工具调用
 *
 * 适用场景：
 * - 确定性的工作流（不需要 LLM 的推理能力）
 * - 批量处理（需要精确控制执行顺序）
 * - 自动化脚本（替代 shell 脚本）
 *
 * 与 runAgent 的区别：
 * - runAgent：LLM 决定调用哪个工具（智能但有不确定性）
 * - runPipeline：开发者指定工具调用序列（确定但需要手动编排）
 *
 * @param steps     - 工具调用序列
 * @param registry  - 工具注册表
 * @param context   - 执行上下文（可选）
 * @param onToolCall - 工具调用回调（可选）
 * @returns 流水线执行结果
 *
 * @example
 *   const result = await runPipeline([
 *     { tool: "read_file", args: { path: "src/index.ts" } },
 *     { tool: "write_file", args: { path: "src/index.ts.bak", content: content } },
 *     { tool: "exec_command", args: { command: "npm test" } },
 *   ], registry);
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
