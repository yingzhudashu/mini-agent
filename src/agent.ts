import "dotenv/config";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { allTools, toolHandlers } from "./tools/weather.js";

// ── LLM Client ──
export const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Core ReAct agent loop.
 * @param userInput - User's message
 * @param systemPrompt - Optional system prompt (default: weather assistant)
 * @param maxTurns - Maximum tool call turns (default: 5)
 * @param onToolCall - Optional callback for tool execution logging
 * @returns Final LLM response text
 */
export async function runAgent(
  userInput: string,
  options?: {
    systemPrompt?: string;
    maxTurns?: number;
    onToolCall?: (name: string, args: string, result: string) => void;
  },
): Promise<string> {
  const systemPrompt = options?.systemPrompt ?? "你是一个有用的助手。如果用户询问天气，请使用 get_weather 工具。";
  const maxTurns = options?.maxTurns ?? 5;
  const onToolCall = options?.onToolCall ?? ((name, args, result) => {
    console.log(`[工具] ${name}(${args}) → ${result}`);
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userInput },
  ];

  let turns = maxTurns;

  while (turns-- > 0) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: allTools,
    });

    const msg = response.choices[0].message;

    // No tool calls — return final response
    if (!msg.tool_calls?.length) {
      return msg.content || "(空回复)";
    }

    // Execute tool calls and append results
    messages.push(msg);

    for (const tc of msg.tool_calls) {
      const handler = toolHandlers[tc.function.name];

      if (!handler) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `错误：未知工具 ${tc.function.name}`,
        });
        continue;
      }

      const args = JSON.parse(tc.function.arguments);
      const result = handler(args);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });

      onToolCall(tc.function.name, tc.function.arguments, result);
    }
  }

  return "达到最大调用次数，请简化请求";
}
