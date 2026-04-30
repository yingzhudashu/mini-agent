/**
 * @file web.ts — 网络工具集
 * @description
 *   提供 2 个网络相关工具：
 *
 *   | 工具       | 功能         | 权限    | 说明                |
 *   |------------|-------------|---------|--------------------|
 *   | fetch_url  | 抓取网页内容   | sandbox | HTML 转纯文本        |
 *   | get_time   | 获取当前时间   | sandbox | 支持自定义时区       |
 *
 *   fetch_url 的设计选择：
 *   - 使用原生 fetch（Node.js 18+ 内置），无需额外依赖
 *   - 简单的 HTML → 文本转换（strip tags），不依赖 cheercheerio/jsdom
 *   - 15 秒超时保护，防止慢请求阻塞 Agent
 *   - 自定义 User-Agent，避免被某些网站拦截
 *
 *   get_time 的设计选择：
 *   - 使用 Intl.DateTimeFormat（Node.js 内置），无需 moment/dayjs
 *   - 支持时区参数，默认为系统时区或 Asia/Shanghai
 *   - 同时返回中文格式化的时间和 ISO 格式
 *
 * @module tools/web
 */

import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// 工具 1: fetch_url — 抓取网页内容
// ============================================================================

const fetchUrlSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "fetch_url",
    description: "抓取网页内容并提取可读文本（自动去除 HTML 标签和脚本）",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的 HTTP/HTTPS 网址" },
        maxChars: { type: "number", description: "最大返回字符数（默认 5000），防止输出过长" },
      },
      required: ["url"],
    },
  },
};

/**
 * fetch_url 工具的处理器
 *
 * 处理流程：
 * 1. 发起 HTTP 请求（带超时和自定义 User-Agent）
 * 2. 检查响应状态码
 * 3. 将 HTML 转为纯文本
 * 4. 截断到 maxChars（防止过长的响应淹没 Agent 上下文）
 *
 * HTML 转纯文本策略：
 * 使用正则表达式，简单但有缺陷：
 * - ✅ 优点：零依赖，速度快
 * - ❌ 缺点：不处理 CSS/JS 动态内容，不解析实体编码，不处理嵌套标签
 * - 对于简单的静态页面（文档、博客、新闻）够用
 * - 对于复杂的 SPA（React/Vue 应用），可能只拿到空壳 HTML
 *
 * 未来优化方向：
 * - 集成 JSDOM / Cheercheerio 进行更准确的 HTML 解析
 * - 集成 Playwright 进行浏览器渲染（可以执行 JS）
 * - 添加 Markdown 模式输出（更适合 LLM 消费）
 */
async function fetchUrlHandler(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
  const url = args.url as string;
  const maxChars = (args.maxChars as number) ?? 5000;

  try {
    // 创建 AbortController 用于超时控制
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000); // 15 秒超时

    // 发起 HTTP 请求
    const response = await fetch(url, {
      signal: controller.signal,
      // 自定义 User-Agent，模拟浏览器请求
      // 有些网站会拦截默认的 "node-fetch" 或空 User-Agent
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MiniAgent/1.0)" },
    });

    clearTimeout(timer); // 请求成功，清除超时计时器

    // 检查 HTTP 状态码
    if (!response.ok) {
      return { success: false, content: `❌ HTTP ${response.status}: ${response.statusText}` };
    }

    // 读取响应体为文本
    const text = await response.text();

    // HTML → 纯文本转换
    // 分步骤清理：
    // 1. 移除 <script> 标签及其内容（包括多行脚本）
    const clean = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      // 2. 移除 <style> 标签及其内容
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // 3. 移除所有剩余的 HTML 标签，替换为换行
      .replace(/<[^>]+>/g, "\n")
      // 4. 将 3 个以上的连续换行压缩为 2 个（保持段落间距）
      .replace(/\n{3,}/g, "\n\n")
      // 5. 去除首尾空白
      .trim();

    // 截断到 maxChars
    const result = clean.length > maxChars
      ? clean.slice(0, maxChars) + "\n... (已截断，使用 maxChars 参数获取更多)"
      : clean;

    return { success: true, content: result };
  } catch (err: any) {
    // 网络错误（DNS 解析失败、连接超时、SSL 错误等）
    // err.message 包含具体错误信息
    return { success: false, content: `❌ 抓取失败: ${err?.message ?? err}` };
  }
}

// ============================================================================
// 工具 2: get_time — 获取当前时间
// ============================================================================

const timeSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_time",
    description: "获取当前时间和日期信息",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "时区名称（如 Asia/Shanghai, America/New_York），默认使用系统时区" },
      },
    },
  },
};

/**
 * get_time 工具的处理器
 *
 * 使用 Intl.DateTimeFormat（ECMAScript 国际化 API）进行时间格式化：
 * - 无需外部依赖
 * - 支持任意 IANA 时区
 * - 支持多种语言和格式
 *
 * 输出格式：
 * - 中文完整格式：2026年4月30日星期四 20:35:16
 * - ISO 格式：2026-04-30T12:35:16.447Z
 *
 * 同时输出两种格式的好处：
 * - 中文格式：用户可读，适合直接展示
 * - ISO 格式：机器可读，适合 LLM 进行时间计算（如"距离这个日期还有几天"）
 */
async function timeHandler(args: Record<string, unknown>): Promise<ToolResult> {
  // 时区优先级：
  // 1. 用户传入的 timezone 参数
  // 2. 环境变量 TZ
  // 3. 默认 Asia/Shanghai
  const tz = (args.timezone as string) ?? process.env.TZ ?? "Asia/Shanghai";

  const now = new Date();

  // 中文格式化选项
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: "long",      // 星期几（如"星期四"）
    year: "numeric",      // 年份（如"2026"）
    month: "long",        // 月份（如"4月"）
    day: "numeric",       // 日期（如"30"）
    hour: "2-digit",      // 小时（24 小时制，两位）
    minute: "2-digit",    // 分钟（两位）
    second: "2-digit",    // 秒（两位）
    hour12: false,        // 24 小时制
  };

  // 生成中文格式的时间字符串
  const formatted = new Intl.DateTimeFormat("zh-CN", options).format(now);
  // 生成 ISO 格式
  const iso = now.toISOString();

  return { success: true, content: `当前时间 (${tz}): ${formatted}\nISO: ${iso}` };
}

// ============================================================================
// 导出网络工具
// ============================================================================

export const webTools: Record<string, ToolDefinition> = {
  fetch_url: { schema: fetchUrlSchema, handler: fetchUrlHandler, permission: "sandbox", help: "抓取网页内容并提取文本", category: "web" },
  get_time: { schema: timeSchema, handler: timeHandler, permission: "sandbox", help: "获取当前时间和日期", category: "core" },
};
