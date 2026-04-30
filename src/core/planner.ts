import OpenAI from "openai";
import type { StructuredPlan, Toolbox } from "./types.js";

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
 * 不与 agent.ts 共享，避免循环依赖
 */
function createPlannerClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function generatePlan(
  userInput: string,
  toolboxes: Toolbox[],
): Promise<StructuredPlan> {
  const toolboxesJson = JSON.stringify(toolboxes.map(t => ({
    id: t.id, name: t.name, description: t.description, keywords: t.keywords
  })));

  const messages = [
    { role: "system" as const, content: PLAN_SYSTEM_PROMPT },
    { role: "user" as const, content: `用户需求: ${userInput}\n\n可用工具箱:\n${toolboxesJson}` },
  ];

  const plannerClient = createPlannerClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await plannerClient.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.3,
        max_tokens: 2048,
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("Empty response from planner");

      // Handle markdown code blocks
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const plan = JSON.parse(jsonStr) as StructuredPlan;

      if (!plan.steps || !plan.requiredToolboxes) {
        throw new Error("Invalid plan: missing required fields");
      }

      return plan;
    } catch {
      if (attempt === 2) return generateFallbackPlan(userInput);
    }
  }

  return generateFallbackPlan(userInput);
}

function generateFallbackPlan(userInput: string): StructuredPlan {
  return {
    summary: "直接执行模式：跳过详细规划",
    steps: [{ stepNumber: 1, description: "根据用户需求直接处理", requiredToolboxes: [], expectedInput: userInput, expectedOutput: "用户需求的回复" }],
    requiredToolboxes: [],
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
