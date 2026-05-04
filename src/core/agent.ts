/**
 * @file agent.ts — Agent 编排层
 * @description
 *   Mini Agent v4 的主入口，实现两阶段架构的编排：
 *
 *   Phase 1: Planning（规划阶段）
 *   - 输入: 用户需求 + 可用工具箱描述
 *   - 过程: LLM 分析需求，生成结构化执行计划
 *   - 输出: StructuredPlan（步骤、工具箱、配置、预估）
 *
 *   Phase 2: Execution（执行阶段）
 *   - 输入: StructuredPlan + 用户需求
 *   - 过程: ReAct 循环（思考 → 工具调用 → 执行 → 反馈）
 *   - 输出: 最终回复
 *
 *   工具筛选策略：
 *   - "all"     → 发送全部工具
 *   - "toolbox" → 只发送 plan.requiredToolboxes 的工具
 *   - "auto"    → 预留，未来可用语义匹配
 *
 *   配置合并优先级（从低到高）：
 *   1. getDefaultAgentConfig() → 默认值
 *   2. runAgent(options.agentConfig) → 用户显式传入
 *   3. plan.suggestedConfig → 规划器推荐（最高优先级）
 *
 *   导出项：
 *   - runAgent(): 两阶段主入口
 *   - runPipeline(): 线性管线执行器（无 LLM 循环）
 *   - client, MODEL: 从 executor 重新导出
 *
 * @module core/agent
 */

import type {
  ToolRegistry,
  ToolMonitor,
  ToolContext,
  PipelineResult,
  PipelineStep,
  StructuredPlan,
  Toolbox,
  AgentConfig,
} from "../types/index.js";
import { DefaultToolMonitor } from "./monitor.js";
import { getDefaultWorkspace } from "../security/sandbox.js";
import { getDefaultAgentConfig, mergeAgentConfig } from "./config.js";
// ReAct 循环执行器（v4.8 拆分）
import { executePlan, client, MODEL } from "./executor.js";
// SessionManager（v4.7）
export { getSessionManager } from "../session/index.js";

// ============================================================================
// 重新导出 executor 的共享资源
// ============================================================================

/** 全局共享的 OpenAI 客户端实例 */
export { client } from "./executor.js";

/** 当前使用的模型名称 */
export { MODEL } from "./executor.js";

// ============================================================================
// 主入口：两阶段 Agent
// ============================================================================

/**
 * 运行 Agent（两阶段模式）
 *
 * 这是外部调用的主入口，实现了完整的两阶段流程。
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
    onPlan?: (plan: StructuredPlan) => Promise<boolean>; // returns true to approve
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

  // ── 合并配置 ──
  const baseConfig = getDefaultAgentConfig();
  const agentConfig = mergeAgentConfig(baseConfig, options.agentConfig ?? {});

  let plan: StructuredPlan;

  // ── 直接执行模式 ──
  // 当 skipPlanning=true 或没有提供工具箱时，跳过规划阶段
  if (skipPlanning || toolboxes.length === 0) {
    plan = createDefaultPlan();
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
      if (!approved) return "⚠️ 操作已取消";
    }
  }

  // ── Phase 2: 执行 ──
  return executePlan(plan, userInput, registry, monitor, agentConfig, onToolCall);
}

/**
 * 创建默认计划（用于直接执行模式）
 *
 * 当 skipPlanning=true 或未提供工具箱时，生成一个最小化的默认计划。
 * 不经过 LLM 规划，直接执行 ReAct 循环。
 *
 * @returns 默认的结构化执行计划
 */
function createDefaultPlan(): StructuredPlan {
  return {
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
      const err = { success: false, content: `⚠️ 未知工具: ${step.tool}` };
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
