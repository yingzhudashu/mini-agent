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

const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

async function main() {
  console.log("🤖 Mini Agent v3 已启动");
  console.log(`📡 模型: ${MODEL}`);
  console.log(`📂 工作空间: ${getDefaultWorkspace()}`);
  console.log(`🧰 工具箱: ${DEFAULT_TOOLBOXES.map(t => t.name).join(", ")}`);
  console.log(`🔧 工具: ${registry.list().join(", ")}`);
  console.log('💡 输入问题，或 "quit" 退出 | ".plan <内容>" 跳过规划 | ".stats" 统计');
  console.log("─".repeat(60));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let resolveAsk: ((v: string | null) => void) | null = null;
  rl.on("close", () => { resolveAsk?.(null); });
  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try { rl.question(q, (answer) => resolve(answer)); } catch { resolve(null); }
  });

  while (true) {
    const input = await ask("\n> ");
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    if (input === ".stats") {
      console.log("\n" + monitor.report());
      continue;
    }

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

  rl.close();
  console.log("\n👋 bye");
  console.log("\n" + monitor.report());
}

main().catch(console.error);
