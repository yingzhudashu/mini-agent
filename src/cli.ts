/**
 * @file cli.ts — CLI 交互入口
 * @description
 *   Mini Agent v3 的用户界面层，负责初始化所有子系统并启动交互循环。
 *
 *   职责：
 *   1. 加载 .env 环境变量
 *   2. 初始化核心子系统（ToolRegistry、ToolMonitor）
 *   3. 注册所有工具（filesystem、exec、web）
 *   4. 显示欢迎信息和工作空间概览
 *   5. 启动 readline 循环，处理用户输入
 *   6. 处理内置命令（.stats、.plan、quit）
 *   7. 打印最终统计报告
 *
 *   启动流程：
 *   ```
 *   dotenv 加载 .env
 *   → 创建 ToolRegistry + ToolMonitor
 *   → 注册所有工具（11 个）
 *   → 显示欢迎信息（模型、工具箱、工具列表）
 *   → readline 循环：
 *     → 用户输入
 *     → .stats → 显示统计
 *     → .plan <内容> → 跳过规划直接执行
 *     → 其他 → runAgent() 两阶段执行
 *     → 显示回复
 *     → 重复...
 *   → quit → 打印最终报告 → 退出
 *   ```
 *
 *   内置命令：
 *   - `.stats` — 查看工具使用统计（调用次数、成功率、平均耗时）
 *   - `.plan <内容>` — 跳过规划阶段，直接执行（适合简单操作）
 *   - `quit` / `exit` — 退出程序
 *
 * @module cli
 */

import "dotenv/config";
import readline from "readline";
import { runAgent, MODEL } from "./core/agent.js";
import { DefaultToolRegistry } from "./core/registry.js";
import { DefaultToolMonitor } from "./core/monitor.js";
import { getDefaultWorkspace } from "./security/sandbox.js";
import { DEFAULT_TOOLBOXES } from "./toolboxes.js";
import { filesystemTools } from "./tools/filesystem.js";
import { execTools } from "./tools/exec.js";
import { webTools } from "./tools/web.js";

// ── 初始化核心子系统 ──

/** 工具注册表：管理所有工具的生命周期 */
const registry = new DefaultToolRegistry();

/** 性能监控器：自动记录工具调用的耗时和成功率 */
const monitor = new DefaultToolMonitor();

// 注册所有工具（11 个）
// 使用 Object.entries() 遍历，添加工具只需加一行 import + register
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
 * 两阶段模式：先规划（Phase 1）后执行（Phase 2）。
 */
async function main() {
  // ── 显示欢迎信息 ──
  console.log("🤖 Mini Agent v3 已启动");
  console.log(`📡 模型: ${MODEL}`);
  console.log(`📂 工作空间: ${getDefaultWorkspace()}`);
  console.log(`🧰 工具箱: ${DEFAULT_TOOLBOXES.map(t => t.name).join(", ")}`);
  console.log(`🔧 工具: ${registry.list().join(", ")}`);
  console.log('💡 输入问题，或 "quit" 退出 | ".plan <内容>" 跳过规划 | ".stats" 统计');
  console.log("─".repeat(60));

  // ── 创建 readline 接口 ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // ── 异步问答处理 ──
  // readline.question() 是回调式的，用 Promise 包装为 async/await
  let resolveAsk: ((v: string | null) => void) | null = null;
  rl.on("close", () => { resolveAsk?.(null); });

  /** 向用户提问并等待回答 */
  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try { rl.question(q, (answer) => resolve(answer)); } catch { resolve(null); }
  });

  // ── 主循环 ──
  while (true) {
    const input = await ask("\n> ");
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    // 内置命令：显示统计
    if (input === ".stats") {
      console.log("\n" + monitor.report());
      continue;
    }

    // 内置命令：跳过规划
    const skipPlanning = input.startsWith(".plan ");
    const actualInput = skipPlanning ? input.slice(6) : input;

    try {
      const reply = await runAgent(actualInput, {
        registry,
        monitor,
        toolboxes: DEFAULT_TOOLBOXES,
        skipPlanning,
        agentConfig: { debug: true },
        onToolCall: (name, args, result) => {
          const short = result.length > 100 ? result.slice(0, 100) + "..." : result;
          console.log(`  🔧 ${name} → ${short}`);
        },
        onPlan: async (plan) => {
          console.log("\n📋 执行计划:");
          console.log(`  摘要: ${plan.summary}`);
          console.log(`  工具箱: ${plan.requiredToolboxes.join(", ")}`);
          console.log(`  预估 token: ${plan.estimatedTokens.total}`);
          console.log(`  风险: ${plan.riskLevel}`);
          if (plan.confirmationMessage) console.log(`  ⚠️ ${plan.confirmationMessage}`);
          const confirm = await ask("\n✅ 确认执行? (y/n): ");
          return confirm?.toLowerCase() === "y";
        },
      });
      console.log(`\n🦾 ${reply}`);
    } catch (err: any) {
      console.error(`\n❌ 错误: ${err?.message ?? err}`);
    }
  }

  // ── 清理和退出 ──
  rl.close();
  console.log("\n👋 bye");
  console.log("\n" + monitor.report());
}

main().catch(console.error);
