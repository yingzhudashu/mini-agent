/**
 * Web tools: fetch_url and search
 */
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

const fetchUrlSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "fetch_url",
    description: "抓取网页内容并提取可读文本",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP/HTTPS URL" },
        maxChars: { type: "number", description: "最大返回字符数" },
      },
      required: ["url"],
    },
  },
};

async function fetchUrlHandler(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
  const url = args.url as string;
  const maxChars = (args.maxChars as number) ?? 5000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MiniAgent/1.0)" },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return { success: false, content: `❌ HTTP ${response.status}: ${response.statusText}` };
    }

    const text = await response.text();
    // Simple HTML-to-text: strip tags
    const clean = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const result = clean.length > maxChars ? clean.slice(0, maxChars) + "\n... (已截断)" : clean;
    return { success: true, content: result };
  } catch (err: any) {
    return { success: false, content: `❌ 抓取失败: ${err?.message ?? err}` };
  }
}

const timeSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_time",
    description: "获取当前时间和日期信息",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "时区名称，如 Asia/Shanghai" },
      },
    },
  },
};

async function timeHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const tz = (args.timezone as string) ?? process.env.TZ ?? "Asia/Shanghai";
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const formatted = new Intl.DateTimeFormat("zh-CN", options).format(now);
  const iso = now.toISOString();
  return { success: true, content: `当前时间 (${tz}): ${formatted}\nISO: ${iso}` };
}

export const webTools: Record<string, ToolDefinition> = {
  fetch_url: { schema: fetchUrlSchema, handler: fetchUrlHandler, permission: "sandbox", help: "抓取网页内容" },
  get_time: { schema: timeSchema, handler: timeHandler, permission: "sandbox", help: "获取当前时间" },
};
