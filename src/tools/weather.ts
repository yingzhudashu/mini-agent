import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * Weather tool definition and implementation.
 * Replace the mock data with a real weather API in production.
 */

// ── Tool Definition (OpenAI format) ──
export const weatherTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "获取指定城市的天气信息",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称，如 北京、上海、深圳" },
      },
      required: ["city"],
    },
  },
};

// ── Mock Weather Data ──
const WEATHERS: Record<string, string> = {
  "北京": "北京今天晴，气温 18°C ~ 28°C，微风",
  "上海": "上海今天多云转小雨，气温 20°C ~ 26°C，东风3级",
  "深圳": "深圳今天晴转多云，气温 25°C ~ 32°C，南风2级",
  "广州": "广州今天雷阵雨，气温 24°C ~ 31°C，南风3级",
};

/**
 * Get weather info for a city.
 * @param city - City name in Chinese
 * @returns Weather description string
 */
export function getWeather(city: string): string {
  return WEATHERS[city] || `${city}的天气数据暂无，当前模拟温度 22°C`;
}

/**
 * Tool execution map — maps tool names to handler functions.
 * Add new tools here and update the tools array above.
 */
export const toolHandlers: Record<string, (args: any) => string> = {
  get_weather: (args) => getWeather(args.city),
};

/**
 * Export all tool definitions as an array for LLM API.
 */
export const allTools: ChatCompletionTool[] = [weatherTool];
