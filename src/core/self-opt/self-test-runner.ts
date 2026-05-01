/**
 * @file self-test-runner.ts — Self-Test Runner 自动测试执行器
 * @description
 *   执行优化提案的测试用例，支持失败自动修复循环。
 *   Phase 4 更新：集成 diff-generator 实现 LLM 驱动的自动修复。
 *
 *   工作流程：
 *   1. 依次执行提案中的测试用例
 *   2. 全部通过 → 标记成功
 *   3. 有失败 → 调用 diff-generator 生成修复补丁 → 应用 → 重试（最多 2 次）
 *   4. 修复后仍失败 → 标记失败，建议回滚
 *
 *   安全规则：
 *   - 修复次数上限 2 次（防死循环铁则）
 *   - 超时上限 120 秒
 *   - 禁止执行危险命令（rm -rf /, mkfs 等）
 *
 * @module core/self-opt/self-test-runner
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  OptimizationProposal,
  OptimizationResult,
  TestExecutionResult,
  FileChange,
} from "./types.js";
import { generateFixDiff } from "./diff-generator.js";

// ============================================================================
// 安全常量
// ============================================================================

/** 危险命令黑名单 */
const DANGEROUS_COMMANDS = [
  "rm -rf /", "rm -rf /*", "mkfs", "dd if=",
  "> /dev/", "chmod 777 /", "sudo rm", "format", "shutdown", "reboot",
];

/** 单次测试超时上限（毫秒） */
const TEST_TIMEOUT_MS = 60000;

/** 总超时上限（毫秒） */
const TOTAL_TIMEOUT_MS = 120000;

/** 自动修复最大尝试次数 */
const MAX_FIX_ATTEMPTS = 2;

// ============================================================================
// 安全校验
// ============================================================================

/**
 * 检查命令是否安全
 * @param command 要检查的命令
 * @returns 是否安全
 */
function isCommandSafe(command: string): boolean {
  const lower = command.toLowerCase();
  return !DANGEROUS_COMMANDS.some((d) => lower.includes(d));
}

// ============================================================================
// 测试执行
// ============================================================================

/**
 * 执行单个测试用例
 * @param testCaseId 测试用例 ID
 * @param command 测试命令
 * @param cwd 工作目录
 * @returns 测试执行结果
 */
function runTestCase(
  testCaseId: string,
  command: string,
  cwd: string
): Promise<TestExecutionResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = "";
    let completed = false;

    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve({
          testCaseId,
          passed: false,
          output: output + "\n[超时] 测试执行超过 60 秒",
          durationMs: Date.now() - startTime,
        });
      }
    }, TEST_TIMEOUT_MS);

    if (!isCommandSafe(command)) {
      clearTimeout(timeoutId);
      resolve({
        testCaseId,
        passed: false,
        output: "[安全拦截] 命令包含危险操作，已阻止执行",
        durationMs: 0,
      });
      return;
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    try {
      const child = spawn(cmd, args, {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: TEST_TIMEOUT_MS,
      });

      child.stdout.on("data", (d) => (output += d.toString()));
      child.stderr.on("data", (d) => (output += d.toString()));

      child.on("close", (code) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          resolve({
            testCaseId,
            passed: code === 0,
            output,
            durationMs: Date.now() - startTime,
          });
        }
      });

      child.on("error", (err) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutId);
          resolve({
            testCaseId,
            passed: false,
            output: output + `\n[错误] ${err.message}`,
            durationMs: Date.now() - startTime,
          });
        }
      });
    } catch (err: any) {
      if (!completed) {
        completed = true;
        clearTimeout(timeoutId);
        resolve({
          testCaseId,
          passed: false,
          output: `[错误] 无法执行命令: ${err?.message ?? err}`,
          durationMs: 0,
        });
      }
    }
  });
}

// ============================================================================
// 文件变更应用
// ============================================================================

/**
 * 应用文件变更
 * @param changes 文件变更列表
 * @param cwd 工作目录
 * @returns 操作结果
 */
async function applyFileChanges(
  changes: FileChange[],
  cwd: string
): Promise<{ success: boolean; error?: string }> {
  try {
    for (const f of changes) {
      const full = path.isAbsolute(f.path) ? f.path : path.join(cwd, f.path);
      if (f.action === "create" || f.action === "modify") {
        const dir = path.dirname(full);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (f.content) fs.writeFileSync(full, f.content, "utf-8");
      } else if (f.action === "delete" && fs.existsSync(full)) {
        fs.unlinkSync(full);
      }
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 执行优化提案
 *
 * 执行流程：
 * 1. 检查总超时
 * 2. 依次执行测试用例
 * 3. 全部通过 → 返回成功
 * 4. 有失败 → 调用 diff-generator 修复 → 重试（最多 2 次）
 * 5. 修复失败 → 返回失败
 *
 * @param proposal 优化提案
 * @param cwd 工作目录
 * @param applyChangesFn 应用文件变更的函数（可选）
 * @returns 优化执行结果
 */
export async function executeOptimization(
  proposal: OptimizationProposal,
  cwd: string,
  applyChangesFn?: (
    changes: FileChange[]
  ) => Promise<{ success: boolean; error?: string }>
): Promise<OptimizationResult> {
  const startTime = Date.now();
  const applyFn = applyChangesFn || ((c) => applyFileChanges(c, cwd));
  let fixAttempts = 0;

  while (true) {
    // 检查总超时
    const elapsed = Date.now() - startTime;
    if (elapsed > TOTAL_TIMEOUT_MS) {
      return {
        proposalId: proposal.id,
        status: "failed",
        testResults: [],
        testSummary: { total: 0, passed: 0, failed: 0 },
        fixAttempts,
        reverted: false,
        lesson: "优化执行超时（120 秒），已终止",
        timestamp: new Date().toISOString(),
        totalDurationSeconds: elapsed / 1000,
      };
    }

    // 执行所有测试用例
    const testResults: TestExecutionResult[] = [];
    for (const tc of proposal.testCases) {
      const result = await runTestCase(tc.id, tc.command, cwd);
      testResults.push(result);

      // 如果失败且还有修复次数，调用 diff-generator
      if (!result.passed && fixAttempts < MAX_FIX_ATTEMPTS) {
        console.log(
          `[self-opt] 测试失败，尝试自动修复 (${fixAttempts + 1}/${MAX_FIX_ATTEMPTS})...`
        );

        const diffResult = await generateFixDiff(
          proposal,
          testResults,
          path.join(cwd, "src")
        );

        if (diffResult.success && diffResult.changes.length > 0) {
          console.log(
            `  [self-opt] 生成 ${diffResult.changes.length} 个文件变更，应用...`
          );
          const applied = await applyFn(diffResult.changes);
          if (applied.success) {
            fixAttempts++;
            break; // 继续循环，重新执行测试
          } else {
            console.log(`  [self-opt] 应用修复失败: ${applied.error}`);
          }
        } else {
          console.log("  [self-opt] 无法生成修复补丁");
        }
      }
    }

    const passed = testResults.filter((r) => r.passed).length;
    const total = testResults.length;
    const failed = total - passed;

    if (failed === 0) {
      return {
        proposalId: proposal.id,
        status: "success",
        testResults,
        testSummary: { total, passed, failed },
        fixAttempts,
        reverted: false,
        lesson: "所有测试通过，优化成功",
        timestamp: new Date().toISOString(),
        totalDurationSeconds: (Date.now() - startTime) / 1000,
      };
    } else if (fixAttempts >= MAX_FIX_ATTEMPTS) {
      return {
        proposalId: proposal.id,
        status: "failed",
        testResults,
        testSummary: { total, passed, failed },
        fixAttempts,
        reverted: false,
        lesson: `${failed}/${total} 个测试失败，修复 ${fixAttempts} 次后仍失败。建议回滚到 Git 快照`,
        timestamp: new Date().toISOString(),
        totalDurationSeconds: (Date.now() - startTime) / 1000,
      };
    }
    // 否则继续修复循环
  }
}

// ============================================================================
// 向后兼容的导出
// ============================================================================

/**
 * 格式化测试结果
 * @param results 测试执行结果列表
 * @returns 格式化的文本字符串
 */
export function formatTestResults(results: TestExecutionResult[]): string {
  const lines = [
    "═══════════════════════════════════════════════════",
    "🧪 Test Results",
    "═══════════════════════════════════════════════════",
  ];
  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    lines.push(`${icon} ${r.testCaseId}: ${r.passed ? "通过" : "失败"}`);
    if (!r.passed && r.output) {
      lines.push(`     ${r.output.slice(0, 100)}`);
    }
    lines.push(`     耗时: ${r.durationMs}ms`);
  }
  const passed = results.filter((r) => r.passed).length;
  lines.push(`\n总计: ${passed}/${results.length} 通过`);
  return lines.join("\n");
}

/**
 * 运行提案的测试用例（向后兼容别名）
 * @deprecated 使用 `executeOptimization` 代替
 */
export async function runProposalTests(
  proposal: OptimizationProposal,
  cwd: string
): Promise<{ results: TestExecutionResult[]; passed: boolean }> {
  const result = await executeOptimization(proposal, cwd);
  return {
    results: result.testResults,
    passed: result.status === "success",
  };
}
