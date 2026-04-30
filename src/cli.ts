import { runAgent, MODEL } from "./agent.js";

/**
 * CLI entry point — interactive chat mode.
 * Run with: npx tsx src/cli.ts
 */
async function main() {
  console.log("🤖 Mini Agent 已启动");
  console.log(`📡 模型: ${MODEL} | 🔗 端点: ${process.env.OPENAI_BASE_URL}`);
  console.log('💡 输入问题，或输入 "quit" 退出');
  console.log("─".repeat(50));

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let resolveAsk: ((v: string | null) => void) | null = null;
  rl.on("close", () => { resolveAsk?.(null); });

  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try {
      rl.question(q, (answer) => resolve(answer));
    } catch {
      resolve(null);
    }
  });

  while (true) {
    const input = await ask("\n> ");
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    try {
      const reply = await runAgent(input);
      console.log(`\n🦾 ${reply}`);
    } catch (err: any) {
      console.error(`\n❌ 错误: ${err?.message ?? err}`);
    }
  }

  rl.close();
  console.log("\n👋 bye");
}

main().catch(console.error);
