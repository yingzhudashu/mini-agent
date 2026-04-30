/**
 * @file exec.ts — 命令执行工具
 * @description
 *   提供在宿主机上执行 shell 命令的能力。
 *
 *   功能特性：
 *   - 自定义超时时间（默认 30 秒）
 *   - 自定义工作目录
 *   - 分别捕获 stdout 和 stderr
 *   - 返回退出码（exit code）
 *   - 安全过滤（沙箱模式下阻止危险命令）
 *
 *   为什么使用 spawn 而不是 exec？
 *   - exec 将整个输出缓存在内存中，大输出会 OOM
 *   - spawn 是流式的，stdout/stderr 通过事件逐块返回，内存占用恒定
 *   - spawn 支持更精细的控制（如 kill、stdin 写入等）
 *
 *   安全考虑：
 *   命令执行是最危险的工具类别。当前实现的安全措施：
 *   1. 路径沙箱不适用（命令本身没有路径限制）
 *   2. 使用 "allowlist" 权限（未来可以配置允许的命令白名单）
 *   3. 沙箱模式下有简单的危险命令过滤
 *
 *   注意：危险命令过滤只是第一道防线，不能完全依赖。
 *   未来应该实现：
 *   - 真正的命令白名单机制
 *   - 资源限制（CPU 时间、内存、网络）
 *   - 沙箱环境（Docker container 或 seccomp）
 *
 * @module tools/exec
 */

import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ============================================================================
// exec_command 工具定义
// ============================================================================

/**
 * exec_command 工具的 OpenAI schema
 *
 * 设计选择：
 * - 只接受 command 字符串（shell: true），不接受 args 数组
 *   原因：LLM 生成命令更自然（"ls -la" 而不是 ["ls", "-la"]）
 * - timeout 参数让 LLM 可以自行判断哪些命令需要更长时间
 */
const execSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "exec_command",
    description: "执行 shell 命令",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的 shell 命令" },
        cwd: { type: "string", description: "工作目录（可选，默认使用当前工作目录）" },
        timeout: { type: "number", description: "超时时间（秒），默认 30 秒" },
      },
      required: ["command"],
    },
  },
};

/**
 * exec_command 工具的处理器
 *
 * 执行流程：
 * 1. 安全检查（沙箱模式下的危险命令过滤）
 * 2. 启动子进程（spawn + shell: true）
 * 3. 监听 stdout/stderr，逐块收集输出
 * 4. 设置超时计时器
 * 5. 进程结束后返回结果（stdout + stderr + exit code）
 *
 * 超时处理：
 * - 使用 setTimeout + SIGKILL 强制终止
 * - SIGKILL 不可被捕获或忽略，确保进程一定能终止
 * - 超时后仍然返回已经收集到的 stdout（可能有用）
 *
 * @param args.command - 要执行的 shell 命令字符串
 * @param args.cwd - 工作目录（可选）
 * @param args.timeout - 超时秒数（可选，默认 30）
 */
async function execHandler(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = args.command as string;
  const cwd = (args.cwd as string) ?? ctx.cwd;
  const timeout = ((args.timeout as number) ?? 30) * 1000; // 秒转毫秒

  // ── 安全检查 ──
  // 沙箱模式下，阻止明显的危险命令
  // 这只是第一道防线，不能完全依赖
  if (ctx.permission === "sandbox") {
    const blocked = [
      "rm -rf /",    // 删除根目录
      "rm -rf ~",    // 删除用户目录
      "sudo rm",     // 提权删除
      "mkfs",        // 格式化磁盘
      "dd if=",      // 底层磁盘写入
      "> /dev/",     // 写入设备文件
    ];
    for (const pattern of blocked) {
      if (command.includes(pattern)) {
        return { success: false, content: `❌ 命令被拒绝: 包含危险操作 "${pattern}"` };
      }
    }
  }

  // ── 执行命令 ──
  return new Promise((resolve) => {
    // spawn: 流式执行，内存效率高
    // shell: true: 支持 shell 语法（管道、重定向、变量等）
    // stdio: ["pipe", "pipe", "pipe"]: 分别捕获 stdin/stdout/stderr
    const child = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let killed = false;

    // 设置超时计时器
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL"); // 强制终止，不可被忽略
    }, timeout);

    // 逐块收集 stdout
    child.stdout.on("data", (d) => { stdout += d.toString(); });

    // 逐块收集 stderr
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    // 进程结束回调
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = stdout.trim();
      const errOut = stderr.trim();

      // 超时情况
      if (killed) {
        resolve({
          success: false,
          content: `⏱ 命令执行超时 (${timeout / 1000}s)\n\n已输出:\n${output || "(无)"}`,
        });
        return;
      }

      // 拼接输出
      let content = "";
      if (output) content += output;
      if (errOut) content += `\n[stderr]\n${errOut}`;
      if (!content) content = "(无输出)";
      content += `\n\n[exit code: ${code}]`;

      // exit code 0 表示成功，非 0 表示失败
      resolve({ success: code === 0, content });
    });

    // 进程启动失败（如 shell 不可用）
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, content: `❌ 执行失败: ${err.message}` });
    });
  });
}

// ============================================================================
// 导出命令执行工具
// ============================================================================

/**
 * 命令执行工具注册表
 *
 * 使用 "allowlist" 权限：
 * - 比 "sandbox" 更严格（意味着需要额外的安全策略）
 * - 比 "require-confirm" 更宽松（命令执行是 Agent 的核心能力，不应每次都确认）
 *
 * 未来可以在 allowlist 中配置：
 * - 允许的命令白名单（如 ls, cat, git, npm test 等）
 * - 阻止的命令黑名单（如 rm, mkfs 等）
 * - 资源限制（CPU 时间、内存上限）
 */
export const execTools: Record<string, ToolDefinition> = {
  exec_command: {
    schema: execSchema,
    handler: execHandler,
    permission: "allowlist",
    help: "执行 shell 命令",
  },
};
