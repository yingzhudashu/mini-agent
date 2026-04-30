/**
 * Integration tests for Mini Agent v2.
 * Tests the enhanced ReAct loop with real tools.
 */
import "dotenv/config";
import { runAgent, MODEL } from "../src/core/agent.js";
import { DefaultToolRegistry } from "../src/core/registry.js";
import { DefaultToolMonitor } from "../src/core/monitor.js";
import { filesystemTools, execTools, webTools } from "../src/index.js";
import { getDefaultWorkspace } from "../src/security/sandbox.js";

// Setup
const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

interface TestCase {
  name: string;
  input: string;
  expectToolCalls: boolean;
  expectToolCount?: number;
}

const testCases: TestCase[] = [
  { name: "基础对话（无工具）", input: "你好，简单测试一下", expectToolCalls: false },
  { name: "查询时间", input: "现在几点了？", expectToolCalls: true, expectToolCount: 1 },
  { name: "读取文件", input: `读取 ${getDefaultWorkspace()}/package.json 的内容`, expectToolCalls: true },
];

let passed = 0;
let failed = 0;

console.log(`📡 模型: ${MODEL} | 端点: ${process.env.OPENAI_BASE_URL}`);
console.log(`🔧 工具: ${registry.list().length} 个 (${registry.list().join(", ")})`);
console.log(`🧪 测试用例: ${testCases.length} 个\n`);

for (const tc of testCases) {
  console.log(`${"═".repeat(60)}`);
  console.log(`📋 ${tc.name}`);
  console.log(`👤 输入: ${tc.input}`);
  console.log("─".repeat(60));

  const toolCalls: string[] = [];

  try {
    const reply = await runAgent(tc.input, {
      registry,
      monitor,
      onToolCall: (name, args, result) => {
        toolCalls.push(name);
        const short = result.length > 80 ? result.slice(0, 80) + "..." : result;
        console.log(`  [工具] ${name}(${args}) → ${short}`);
      },
    });

    console.log(`🦾 回复: ${reply}`);

    // Assertions
    if (tc.expectToolCalls && toolCalls.length === 0) {
      console.log(`❌ FAIL: 期望有工具调用，但未触发`);
      failed++;
    } else if (!tc.expectToolCalls && toolCalls.length > 0) {
      console.log(`❌ FAIL: 期望无工具调用，但触发了 ${toolCalls.length} 次`);
      failed++;
    } else if (tc.expectToolCount !== undefined && toolCalls.length !== tc.expectToolCount) {
      console.log(`❌ FAIL: 期望 ${tc.expectToolCount} 次，实际 ${toolCalls.length} 次`);
      failed++;
    } else {
      console.log(`✅ PASS (工具: ${toolCalls.join(", ") || "无"})`);
      passed++;
    }
  } catch (err: any) {
    console.log(`❌ FAIL: ${err?.message ?? err}`);
    failed++;
  }
  console.log();
}

console.log("─".repeat(60));
console.log(`📊 结果: ${passed}/${testCases.length} 通过, ${failed} 失败`);
console.log("\n" + monitor.report());

if (failed > 0) process.exit(1);
