import "dotenv/config";
import readline from "readline";
import { runAgent, MODEL } from "./core/agent.js";
import { DefaultToolRegistry } from "./core/registry.js";
import { DefaultToolMonitor } from "./core/monitor.js";
import { getDefaultWorkspace } from "./security/sandbox.js";

// Import and register all tools
import { filesystemTools } from "./tools/filesystem.js";
import { execTools } from "./tools/exec.js";
import { webTools } from "./tools/web.js";

const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

// Register tools
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

/**
 * CLI entry point — interactive chat mode.
 */
async function main() {
  console.log("🤖 Mini Agent 已启动");
  console.log(`📡 模型: ${MODEL}`);
  console.log(`📂 工作空间: ${getDefaultWorkspace()}`);
  console.log(`🔧 已加载工具: ${registry.list().join(", ")}`);
  console.log('💡 输入问题，或输入 "quit" 退出 | ".stats" 查看统计 | ".tools" 查看工具');
  console.log("─".repeat(60));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let resolveAsk: ((v: string | null) => void) | null = null;
  rl.on("close", () => { resolveAsk?.(null); });

  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try { rl.question(q, (a) => resolve(a)); }
    catch { resolve(null); }
  });

  while (true) {
    const input = await ask("\n> ");
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    // Commands
    if (input === ".stats") { console.log("\n" + monitor.report()); continue; }
    if (input === ".tools") {
      const lines = registry.list().map((n) => {
        const t = registry.get(n)!;
        return `  ${n.padEnd(15)} ${t.help}`;
      });
      console.log("\n🔧 可用工具:\n" + lines.join("\n"));
      continue;
    }

    try {
      const reply = await runAgent(input, {
        registry,
        monitor,
        onToolCall: (name, args, result) => {
          const short = result.length > 100 ? result.slice(0, 100) + "..." : result;
          console.log(`  🔧 ${name} → ${short}`);
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
