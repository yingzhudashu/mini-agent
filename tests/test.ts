/**
 * Integration tests for Mini Agent.
 * Tests the full ReAct loop: user input → LLM → tool call → result → response.
 *
 * Run: npx tsx tests/test.ts
 */
import "dotenv/config";
import { runAgent, MODEL } from "../src/agent.js";

interface TestCase {
  name: string;
  input: string;
  expectToolCalls: boolean;
  expectToolCount?: number;
}

const testCases: TestCase[] = [
  {
    name: "基础对话（无工具调用）",
    input: "你好，简单测试一下",
    expectToolCalls: false,
  },
  {
    name: "单次工具调用（北京天气）",
    input: "北京今天天气怎么样？",
    expectToolCalls: true,
    expectToolCount: 1,
  },
  {
    name: "并行工具调用（多城市天气）",
    input: "上海和深圳的天气分别是什么？",
    expectToolCalls: true,
    expectToolCount: 2,
  },
];

let passed = 0;
let failed = 0;

console.log(`📡 模型: ${MODEL} | 端点: ${process.env.OPENAI_BASE_URL}`);
console.log(`🧪 测试用例: ${testCases.length} 个\n`);

for (const tc of testCases) {
  console.log(`${"═".repeat(50)}`);
  console.log(`📋 ${tc.name}`);
  console.log(`👤 输入: ${tc.input}`);
  console.log("─".repeat(50));

  const toolCalls: string[] = [];

  try {
    const reply = await runAgent(tc.input, {
      onToolCall: (name, args, result) => {
        toolCalls.push(name);
        console.log(`  [工具] ${name}(${args}) → ${result}`);
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
      console.log(`❌ FAIL: 期望 ${tc.expectToolCount} 次工具调用，实际 ${toolCalls.length} 次`);
      failed++;
    } else {
      console.log(`✅ PASS (工具调用: ${toolCalls.length} 次)`);
      passed++;
    }
  } catch (err: any) {
    console.log(`❌ FAIL: ${err?.message ?? err}`);
    failed++;
  }
  console.log();
}

console.log("─".repeat(50));
console.log(`📊 结果: ${passed}/${testCases.length} 通过, ${failed} 失败`);

if (failed > 0) {
  process.exit(1);
}
