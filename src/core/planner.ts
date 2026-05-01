/**
 * @file planner.ts — 规划器（Phase 1）
 * @description
 *   两阶段 Agent 的规划阶段实现。
 *
 *   职责：
 *   1. 接收用户需求和可用工具箱列表
 *   2. 调用 LLM 分析需求，生成结构化执行计划（StructuredPlan）
 *   3. 计划内容包括：步骤分解、工具箱选择、配置推荐、token 预估
 *   4. 支持 3 次重试，全部失败时降级为 fallback 简单计划
 *
 *   为什么 planner 使用独立的 OpenAI client 而非 agent.ts 的共享 client？
 *   - 避免循环依赖（planner → agent → planner → ...）
 *   - 规划阶段可以独立控制 temperature 和 max_tokens
 *   - 未来可以配置不同的模型（如用小模型做规划省 token）
 *
 *   规划流程：
 *   ```
 *   用户需求 + 可用工具箱描述
 *   → LLM 分析（temperature=0.3，追求确定性）
 *   → 解析 JSON 响应（处理 markdown code block）
 *   → 校验必要字段（steps, requiredToolboxes）
 *   → 返回 StructuredPlan
 *   → 失败 → 重试（最多 3 次）
 *   → 全部失败 → 返回 fallback plan（直接执行模式）
 *   ```
 *
 * @module core/planner
 */

import type { StructuredPlan, Toolbox } from "./types.js";
import OpenAI from "openai";
import { appendLog, truncate } from "./logger.js";

/** 规划阶段使用的系统提示词 */
const PLAN_SYSTEM_PROMPT = `你是一个任务规划专家。分析用户需求，生成结构化的执行计划。

请以 JSON 格式返回计划，严格遵循以下 schema：
{
  "summary": "计划摘要（中文）",
  "steps": [
    {
      "stepNumber": 1,
      "description": "步骤描述",
      "requiredToolboxes": ["工具箱ID列表"],
      "expectedInput": "期望输入",
      "expectedOutput": "期望输出",
      "dependsOn": null
    }
  ],
  "requiredToolboxes": ["需要的工具箱ID"],
  "suggestedConfig": {
    "maxTurns": 建议轮数,
    "toolTimeout": 超时秒数,
    "riskLevel": "low|medium|high"
  },
  "estimatedTokens": {
    "promptTokens": 预估prompt token,
    "completionTokens": 预估completion token,
    "toolResultTokens": 预估工具结果token,
    "total": 总计
  },
  "contextStrategy": {
    "mode": "normal|chunked|summarize|truncate",
    "reason": "原因说明"
  },
  "requiresConfirmation": true/false,
  "confirmationMessage": "确认消息（如需要）",
  "riskLevel": "low|medium|high",
  "estimatedCost": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalUSD": 0
  },
  "outputSpec": {
    "language": "zh-CN",
    "format": "markdown",
    "expectedDeliverable": "预期产出描述"
  },
  "fallbackPlan": {
    "degradeToSimple": true,
    "degradedMaxTurns": 5
  }
}

只返回 JSON，不要包含任何其他文字。`;

/**
 * 创建规划器专用的 OpenAI 客户端
 *
 * 不与 agent.ts 共享，避免循环依赖。
 * 规划器使用独立的 client 实例，可以独立配置 temperature 和 max_tokens。
 */
function createPlannerClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

/** 规划器使用的模型（可与执行阶段不同） */
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * 根据用户需求和可用工具箱生成执行计划
 *
 * 工作流程：
 * 1. 将工具箱信息序列化为 JSON 描述
 * 2. 构建 system prompt + user prompt
 * 3. 调用 LLM（temperature=0.3，追求结构化输出的稳定性）
 * 4. 解析响应为 JSON（处理 markdown code block 包裹的情况）
 * 5. 校验必要字段，返回 StructuredPlan
 *
 * 容错机制：
 * - 最多重试 3 次
 * - 解析失败/校验失败/网络异常都会触发重试
 * - 3 次全部失败时，返回 fallback 简单计划（直接执行模式）
 *
 * @param userInput - 用户的原始需求
 * @param toolboxes - 可用工具箱列表
 * @returns 结构化执行计划
 */
export async function generatePlan(
  userInput: string,
  toolboxes: Toolbox[],
  logFile?: string | null,
): Promise<StructuredPlan> {
  // 将工具箱信息序列化为 JSON，供 LLM 理解每个工具箱的能力
  const toolboxesJson = JSON.stringify(toolboxes.map(t => ({
    id: t.id, name: t.name, description: t.description, keywords: t.keywords
  })));

  const messages = [
    { role: "system" as const, content: PLAN_SYSTEM_PROMPT },
    { role: "user" as const, content: `用户需求: ${userInput}\n\n可用工具箱:\n${toolboxesJson}` },
  ];

  const plannerClient = createPlannerClient();

  // 最多重试 3 次
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await plannerClient.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.3, // 低 temperature 追求结构化输出的稳定性
        max_tokens: 2048,
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("Empty response from planner");

      // 增量日志：规划阶段 LLM 交互
      if (logFile) {
        appendLog(logFile, {
          phase: "plan",
          attempt: attempt + 1,
          req: { model: MODEL, messages: messages.map(m => ({ role: m.role, content: truncate(m.content ?? "", 500) })) },
          res: { content: truncate(content, 2000), usage: response.usage },
        });
      }

      // 处理 markdown code block 包裹的情况
      // LLM 有时会返回 ```json {...} ``` 格式
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const plan = JSON.parse(jsonStr) as StructuredPlan;

      // 校验必要字段
      if (!plan.steps || !plan.requiredToolboxes) {
        throw new Error("Invalid plan: missing required fields");
      }

      return plan;
    } catch {
      // 任何异常（网络、解析、校验）→ 重试
      if (attempt === 2) return generateFallbackPlan(userInput);
    }
  }

  // 理论上不会到这里（循环内已处理 fallback）
  return generateFallbackPlan(userInput);
}

/**
 * 生成回退计划（直接执行模式）
 *
 * 当 LLM 规划失败 3 次时调用。
 * 返回一个最简计划：跳过详细规划，直接执行，使用全部工具。
 *
 * @param userInput - 用户原始需求（用于记录）
 * @returns 最简 StructuredPlan
 */
function generateFallbackPlan(userInput: string): StructuredPlan {
  return {
    summary: "直接执行模式：跳过详细规划",
    steps: [{ stepNumber: 1, description: "根据用户需求直接处理", requiredToolboxes: [], expectedInput: userInput, expectedOutput: "用户需求的回复" }],
    requiredToolboxes: [], // 空数组 → 使用全部工具
    suggestedConfig: { maxTurns: 5, toolTimeout: 30, riskLevel: "low" },
    estimatedTokens: { promptTokens: 500, completionTokens: 500, toolResultTokens: 200, total: 1200 },
    contextStrategy: { mode: "normal", reason: "简单任务" },
    requiresConfirmation: false,
    riskLevel: "low",
    estimatedCost: { inputTokens: 500, outputTokens: 500, totalUSD: 0 },
    outputSpec: { language: "zh-CN", format: "markdown", expectedDeliverable: "直接回复" },
    fallbackPlan: { degradeToSimple: false, degradedMaxTurns: 5 },
  };
}
