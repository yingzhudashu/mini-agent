/**
 * Command execution tool with timeout, PTY, and background support.
 */
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

const execSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "exec_command",
    description: "执行 shell 命令",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
        cwd: { type: "string", description: "工作目录" },
        timeout: { type: "number", description: "超时时间（秒），默认 30" },
      },
      required: ["command"],
    },
  },
};

async function execHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = args.command as string;
  const cwd = (args.cwd as string) ?? ctx.cwd;
  const timeout = ((args.timeout as number) ?? 30) * 1000;

  // Security: block dangerous patterns in sandbox mode
  if (ctx.permission === "sandbox") {
    const blocked = ["rm -rf /", "rm -rf ~", "sudo rm", "mkfs", "dd if=", "> /dev/"];
    for (const pattern of blocked) {
      if (command.includes(pattern)) {
        return { success: false, content: `❌ 命令被拒绝: 包含危险操作 "${pattern}"` };
      }
    }
  }

  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeout);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = stdout.trim();
      const errOut = stderr.trim();

      if (killed) {
        resolve({ success: false, content: `⏱ 命令执行超时 (${timeout / 1000}s)\n\n${output}` });
        return;
      }

      let content = "";
      if (output) content += output;
      if (errOut) content += `\n[stderr]\n${errOut}`;
      if (!content) content = "(无输出)";
      content += `\n\n[exit code: ${code}]`;

      resolve({ success: code === 0, content });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, content: `❌ 执行失败: ${err.message}` });
    });
  });
}

export const execTools: Record<string, ToolDefinition> = {
  exec_command: { schema: execSchema, handler: execHandler, permission: "allowlist", help: "执行 shell 命令" },
};
