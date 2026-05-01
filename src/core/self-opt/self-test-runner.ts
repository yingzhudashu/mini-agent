/**
 * @file self-test-runner.ts — Self-Test Runner 自动测试执行器
 * @description
 *   执行优化提案的测试用例，支持失败自动修复循环。
 *
 *   工作流程：
 *   1. 依次执行提案中的测试用例
 *   2. 全部通过 → 标记成功
 *   3. 有失败 → 尝试自动修复（最多 2 次）
 *   4. 修复后仍失败 → 标记失败，建议回滚
 *
 *   安全规则：
 *   - 修复次数上限 2 次（防死循环铁则）
 *   - 超时上限 120 秒
 *   - 禁止执行危险命令
 *
 * @module core/self-opt/self-test-runner
 */

import { spawn } from "node:child_process";
import type { OptimizationProposal, OptimizationResult, TestExecutionResult } from "./types.js";

// ============================================================================
// 配置
// ============================================================================

/** 最大自动修复次数 */
const MAX_FIX_ATTEMPTS = 2;

/** 测试超时（秒） */
const TEST_TIMEOUT_SECONDS = 120;

/** 危险命令关键词 */
const DANGEROUS_COMMANDS = [
  "rm -rf /",
  "mkfs",
  "dd if=",
  "chmod 777 /",
  "sudo rm",
  ":(){:|:&};:",
  "> /dev/sda",
];

// ============================================================================
// 安全检查
// ============================================================================

/** 检查命令是否安全 */
function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  if (!command || command.trim().length === 0) {
    return { safe: false, reason: "空命令" };
  }

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (command.includes(dangerous)) {
      return { safe: false, reason: `包含危险命令: ${dangerous}` };
    }
  }

  return { safe: true };
}

// ============================================================================
// 测试执行
// ============================================================================

/**
 * 执行单个测试命令
 */
function executeTestCommand(
  command: string,
  cwd: string,
  timeoutMs: number = TEST_TIMEOUT_SECONDS * 1000
): Promise<{ passed: boolean; output: string; durationMs: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    try {
      const child = spawn(command, [], {
        cwd,
        shell: true,
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (code) => {
        const duration = Date.now() - startTime;
        resolve({
          passed: code === 0,
          output: stdout + (stderr ? "\nstderr: " + stderr : ""),
          durationMs: duration,
        });
      });

      child.on("error", (err) => {
        const duration = Date.now() - startTime;
        resolve({
          passed: false,
          output: `执行错误: ${err.message}`,
          durationMs: duration,
        });
      });

      child.on("timeout", () => {
        child.kill();
        const duration = Date.now() - startTime;
        resolve({
          passed: false,
          output: `测试超时 (${timeoutMs}ms)`,
          durationMs: duration,
        });
      });
    } catch (err: any) {
      resolve({
        passed: false,
        output: `启动失败: ${err.message}`,
        durationMs: 0,
      });
    }
  });
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行提案的全部测试用例
 *
 * @param proposal 优化提案
 * @param cwd 项目根目录
 * @returns 测试结果
 */
export async function runProposalTests(
  proposal: OptimizationProposal,
  cwd: string
): Promise<TestExecutionResult[]> {
  const results: TestExecutionResult[] = [];

  for (const tc of proposal.testCases) {
    // 安全检查
    const safety = isCommandSafe(tc.command);
    if (!safety.safe) {
      results.push({
        testCaseId: tc.id,
        passed: false,
        output: `安全拦截: ${safety.reason}`,
        durationMs: 0,
      });
      continue;
    }

    const result = await executeTestCommand(tc.command, cwd);
    results.push({
      testCaseId: tc.id,
      passed: result.passed,
      output: result.output.slice(0, 2000), // 截断过长输出
      durationMs: result.durationMs,
    });
  }

  return results;
}

/**
 * 执行优化并测试（含自动修复循环）
 *
 * @param proposal 优化提案
 * @param cwd 项目根目录
 * @param applyChanges 应用文件变更的函数
 * @returns 优化结果
 */
export async function executeOptimization(
  proposal: OptimizationProposal,
  cwd: string,
  applyChanges: () => Promise<{ success: boolean; error?: string }>
): Promise<OptimizationResult> {
  const startTime = Date.now();
  let fixAttempts = 0;
  let lastResults: TestExecutionResult[] = [];
  let status: "success" | "failed" = "failed";
  let lesson = "";

  // ── Step 1: 应用变更 ──
  const applyResult = await applyChanges();
  if (!applyResult.success) {
    return {
      proposalId: proposal.id,
      status: "failed",
      testResults: [],
      testSummary: { total: 0, passed: 0, failed: 0 },
      fixAttempts: 0,
      reverted: false,
      lesson: `变更应用失败: ${applyResult.error}`,
      timestamp: new Date().toISOString(),
      totalDurationSeconds: (Date.now() - startTime) / 1000,
    };
  }

  // ── Step 2: 执行测试 ──
  lastResults = await runProposalTests(proposal, cwd);

  // ── Step 3: 检查是否全部通过 ──
  const allPassed = lastResults.every((r) => r.passed);
  if (allPassed) {
    status = "success";
    lesson = "所有测试通过，优化成功";
  } else {
    // ── Step 4: 自动修复循环 ──
    while (fixAttempts < MAX_FIX_ATTEMPTS) {
      fixAttempts++;
      console.log(`[self-opt] 测试失败，尝试自动修复 (${fixAttempts}/${MAX_FIX_ATTEMPTS})...`);

      // TODO: 这里需要 LLM 介入分析失败原因并生成修复方案
      // 当前版本仅记录失败，自动修复需要 Phase 4 实现
      console.log(`[self-opt] 自动修复逻辑待实现（需要 LLM 分析）`);
      break;
    }

    lesson = `测试失败 (${lastResults.filter((r) => !r.passed).length}/${lastResults.length} 未通过)。建议: 检查变更内容或回滚`;
  }

  // ── 汇总 ──
  const passed = lastResults.filter((r) => r.passed).length;
  const failed = lastResults.filter((r) => !r.passed).length;

  return {
    proposalId: proposal.id,
    status,
    testResults: lastResults,
    testSummary: { total: lastResults.length, passed, failed },
    fixAttempts,
    reverted: false,
    lesson,
    timestamp: new Date().toISOString(),
    totalDurationSeconds: (Date.now() - startTime) / 1000,
  };
}

/**
 * 格式化测试结果为可读文本
 */
export function formatTestResults(result: OptimizationResult): string {
  const lines: string[] = [
    "═══════════════════════════════════════════════════",
    `🧪 Test Results: ${result.status === "success" ? "✅ ALL PASS" : "❌ SOME FAILED"}`,
    "═══════════════════════════════════════════════════",
    `状态: ${result.status}`,
    `测试: ${result.testSummary.passed}/${result.testSummary.total} 通过`,
    `修复尝试: ${result.fixAttempts} 次`,
    `耗时: ${result.totalDurationSeconds.toFixed(1)}s`,
    "",
  ];

  for (const tr of result.testResults) {
    const icon = tr.passed ? "✅" : "❌";
    lines.push(`${icon} [${tr.testCaseId}] ${tr.passed ? "PASS" : "FAIL"} (${tr.durationMs}ms)`);
    if (!tr.passed) {
      const preview = tr.output.slice(0, 200).replace(/\n/g, "\n    ");
      lines.push(`    ${preview}`);
    }
  }

  lines.push("");
  lines.push(`📝 ${result.lesson}`);

  if (result.status === "failed") {
    lines.push("");
    lines.push("💡 建议: 使用 git_snapshot revert 回滚到变更前的状态");
  }

  return lines.join("\n");
}
