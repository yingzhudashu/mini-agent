/**
 * @file cli.ts — CLI 交互入口
 * @description
 *   这是 Mini Agent 的用户界面层。
 *
 *   职责：
 *   1. 初始化所有子系统（工具注册、监控器、沙箱）
 *   2. 注册所有可用工具
 *   3. 启动 readline 循环，读取用户输入
 *   4. 调用 runAgent() 处理请求
 *   5. 处理内置命令（.tools / .stats / quit）
 *   6. 打印最终报告
 *
 *   启动流程：
 *   ```
 *   读取 .env 配置
 *   → 创建 ToolRegistry
 *   → 创建 ToolMonitor
 *   → 注册所有工具
 *   → 显示欢迎信息
 *   → 进入 readline 循环
 *   → 用户输入
 *   → 调用 runAgent()
 *   → 显示回复
 *   → 重复...
 *   → 用户输入 quit → 打印报告 → 退出
 *   ```
 *
 * @module cli
 */

import "dotenv/config";           // 加载 .env 文件中的环境变量
import readline from "readline";  // Node.js 内置的命令行交互模块

// 导入核心模块
import { runAgent, MODEL } from "./core/agent.js";
import { DefaultToolRegistry } from "./core/registry.js";
import { DefaultToolMonitor } from "./core/monitor.js";
import { getDefaultWorkspace } from "./security/sandbox.js";

// 导入所有工具模块
import { filesystemTools } from "./tools/filesystem.js";
import { execTools } from "./tools/exec.js";
import { webTools } from "./tools/web.js";

// ============================================================================
// 初始化子系统
// ============================================================================

/** 创建工具注册表 */
const registry = new DefaultToolRegistry();

/** 创建性能监控器 */
const monitor = new DefaultToolMonitor();

// 注册所有工具
// 使用 Object.entries() 遍历工具对象的键值对
// 这种设计使得添加工具非常简单：只需在工具文件中导出对象，
// 然后在这里加一行 import + register 即可
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

// ============================================================================
// CLI 主循环
// ============================================================================

/**
 * CLI 主函数
 *
 * 交互模式，等待用户输入并显示 Agent 回复。
 * 支持以下内置命令（以 . 开头）：
 * - .tools  — 显示所有可用工具及其描述
 * - .stats  — 显示工具使用统计报告
 * - quit / exit — 退出程序
 */
async function main() {
  // ── 显示欢迎信息 ──
  console.log("🤖 Mini Agent 已启动");
  console.log(`📡 模型: ${MODEL}`);
  console.log(`📂 工作空间: ${getDefaultWorkspace()}`);
  console.log(`🔧 已加载工具: ${registry.list().join(", ")}`);
  console.log('💡 输入问题，或输入 "quit" 退出 | ".stats" 查看统计 | ".tools" 查看工具');
  console.log("─".repeat(60));

  // ── 创建 readline 接口 ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── 异步问答处理 ──
  //
  // 问题：readline.question() 是回调式的，但我们需要 async/await 风格
  // 解决：用 Promise 包装回调，通过 resolveAsk 变量传递 resolver
  //
  // 工作流程：
  // 1. 调用 ask("> ") → 创建 Promise → 调用 rl.question()
  // 2. 用户输入 → rl.question 回调触发 → resolve(answer)
  // 3. await 收到值 → 继续处理
  //
  let resolveAsk: ((v: string | null) => void) | null = null;

  // 当 readline 关闭时（如 Ctrl+D），resolve null 以退出循环
  rl.on("close", () => { resolveAsk?.(null); });

  /**
   * 向用户提问并等待回答
   * @param q - 提示符
   * @returns 用户输入的字符串，或 null（如果 readline 已关闭）
   */
  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try {
      rl.question(q, (answer) => resolve(answer));
    } catch {
      // readline 已关闭时，question() 会抛出 ERR_USE_AFTER_CLOSE
      // 这种情况下返回 null 以优雅退出
      resolve(null);
    }
  });

  // ── 主循环 ──
  while (true) {
    // 读取用户输入
    const input = await ask("\n> ");

    // 处理退出
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;

    // 跳过空输入
    if (!input.trim()) continue;

    // ── 内置命令 ──
    if (input === ".stats") {
      // 显示工具使用统计报告
      console.log("\n" + monitor.report());
      continue;
    }
    if (input === ".tools") {
      // 显示所有工具列表和描述
      const lines = registry.list().map((n) => {
        const t = registry.get(n)!;
        return `  ${n.padEnd(15)} ${t.help}`;
      });
      console.log("\n🔧 可用工具:\n" + lines.join("\n"));
      continue;
    }

    // ── 调用 Agent ──
    try {
      const reply = await runAgent(input, {
        registry,
        monitor,
        onToolCall: (name, args, result) => {
          // 工具调用日志：只显示结果的前 100 字符，避免长输出刷屏
          const short = result.length > 100 ? result.slice(0, 100) + "..." : result;
          console.log(`  🔧 ${name} → ${short}`);
        },
      });
      console.log(`\n🦾 ${reply}`);
    } catch (err: any) {
      // Agent 核心异常（如网络错误、API 密钥无效等）
      console.error(`\n❌ 错误: ${err?.message ?? err}`);
    }
  }

  // ── 清理和退出 ──
  rl.close();
  console.log("\n👋 bye");

  // 打印最终统计报告
  console.log("\n" + monitor.report());
}

// 启动 CLI（捕获未处理的异常，防止程序崩溃时没有错误信息）
main().catch(console.error);
