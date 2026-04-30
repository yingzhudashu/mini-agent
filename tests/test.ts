import "dotenv/config";
import { runAgent, MODEL } from "../src/core/agent.js";
import { DefaultToolRegistry } from "../src/core/registry.js";
import { DefaultToolMonitor } from "../src/core/monitor.js";
import { DEFAULT_TOOLBOXES } from "../src/toolboxes.js";
import { filesystemTools } from "../src/tools/filesystem.js";
import { execTools } from "../src/tools/exec.js";
import { webTools } from "../src/tools/web.js";

const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

console.log(`📡 模型: ${MODEL} | 端点: ${process.env.OPENAI_BASE_URL}`);
console.log(`🔧 工具: ${registry.list().length} 个 (${registry.list().join(", ")})`);
console.log(`🧰 工具箱: ${DEFAULT_TOOLBOXES.length} 个`);
console.log(`🧪 测试用例: 3 个\n`);

interface TestCase { name: string; input: string }
const tests: TestCase[] = [
  { name: "基础对话（无工具）", input: "你好，简单测试一下" },
  { name: "查询时间", input: "现在几点了？" },
  { name: "读取文件", input: "读取 D:\\AIhub\\mini-agent/package.json 的内容" },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  console.log("═".repeat(60));
  console.log(`📋 ${t.name}`);
  console.log(`👤 输入: ${t.input}`);
  console.log("─".repeat(60));

  try {
    const reply = await runAgent(t.input, {
      registry,
      monitor,
      toolboxes: DEFAULT_TOOLBOXES,
      skipPlanning: true,
      onToolCall: (name, _args, result) => {
        const short = result.length > 120 ? result.slice(0, 120) + "..." : result;
        console.log(`  [工具] ${name} → ${short}`);
      },
    });
    console.log(`🦾 回复: ${reply}`);
    console.log("✅ PASS");
    passed++;
  } catch (err: any) {
    console.log(`❌ FAIL: ${err?.message ?? err}`);
    failed++;
  }
  console.log();
}

console.log("─".repeat(60));
console.log(`📊 结果: ${passed}/${passed + failed} 通过, ${failed} 失败`);
if (monitor) console.log("\n📊 工具使用统计:\n" + monitor.report());

process.exit(failed > 0 ? 1 : 0);
