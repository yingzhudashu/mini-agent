/**
 * demo 技能包 — 示例技能
 *
 * 演示如何创建一个完整的技能包，包含：
 * - SKILL.md 文档
 * - index.ts 技能定义
 * - 自定义工具
 */

import type { Skill } from "../../core/types.js";
import type { ToolContext, ToolResult } from "../../core/types.js";

/**
 * demo 工具：hello
 * 返回一句友好的问候
 */
export const hello_demo: any = {
  schema: {
    type: "function" as const,
    function: {
      name: "hello_demo",
      description: "返回一句友好的问候",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "对方的名字",
          },
        },
        required: ["name"],
      },
    },
  },
  handler: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    const name = args.name as string;
    return {
      success: true,
      content: `你好，${name}！欢迎使用 Mini Agent 技能系统 🎉`,
    };
  },
  permission: "sandbox" as const,
  help: "返回友好问候：hello_demo({ name: '名字' })",
};

export const skills: Skill[] = [
  {
    id: "demo",
    name: "演示技能",
    description: "示例技能包，包含一个 hello_demo 工具用于演示技能系统工作原理。",
    keywords: ["demo", "示例", "问候", "hello"],
    tools: { hello_demo },
    systemPrompt: "当用户询问关于技能系统的信息时，可以使用 hello_demo 工具演示技能调用。",
  },
];
