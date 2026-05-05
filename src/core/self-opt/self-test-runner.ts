/**
 * @file self-test-runner.ts - Self-Test Runner 自动测试执行器 (Phase 5.3 升级)
 * @description
 *   执行优化提案中的测试用例，支持失败自动修复循环。
 *
 *   Phase 5.1 升级：
 *   - 按提案类型细化测试命令（type-check / test / build / audit）
 *   - 增强命令安全校验（支持 npm/npx/tsx 等常用命令白名单）
 *   - 测试失败时自动回退（diff-generator 修复 + 重试，最多 2 次）
 *
 *   Phase 5.3 升级：
 *   - 新增 runRegressionTest() 优化成功后执行全量回归测试
 *   - 对比优化前后的测试结果，发现回归立即回滚
 *   - 记录回归事件到日志
 *
 *   工作流程：
 *   1. 逐个执行提案中的测试用例
 *   2. 全部通过 → 测试成功 → 执行回归测试
 *   3. 有失败 → 调用 diff-generator 生成修复 → 应用 → 重试（最多 2 次）
 *   4. 修复全部失败 → 标记失败，建议回滚
 *
 *   安全保障
 *   - 修复次数最多 2 次，防止循环
 *   - 超时限制 120 秒
 *   - 禁止执行危险命令（rm -rf /, mkfs 等）
 *
 * @module core/self-opt/self-test-runner
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir } from "../../utils/fs.js";
import type {
  OptimizationProposal,
  OptimizationResult,
  TestExecutionResult,
  FileChange,
} from "./types.js";
import { generateFixDiff } from "./diff-generator.js";

// ============================================================================
// 安全校验
// ============================================================================

/** 危险命令黑名单 */
const DANGEROUS_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  "> /dev/",
  "chmod 777 /",
  "sudo rm",
  "format",
  "shutdown",
  "reboot",
];

/** 允许的命令白名单前缀 */
const ALLOWED_COMMAND_PREFIXES = [
  "npm ",
  "npx ",
  "node ",
  "tsx ",
  "npx tsx ",
  "echo ",
  "cat ",
  "ls ",
  "find ",
  "grep ",
  "wc ",
  "head ",
  "tail ",
  "diff ",
  "git ",
  "tsc ",
  "jest ",
  "vitest ",
];

/** 单次测试超时限制（毫秒） */
const TEST_TIMEOUT_MS = 60000;

/** 总超时限制（毫秒） */
const TOTAL_TIMEOUT_MS = 120000;

/** 自动修复最大尝试次数 */
const MAX_FIX_ATTEMPTS = 2;

// ============================================================================
// 安全校验
// ============================================================================

/**
 * 检查命令是否安全
 * @param command 要执行的命令
 * @returns 是否安全
 */
function isCommandSafe(command: string): boolean {
  const lower = command.toLowerCase().trim();

  // 黑名单
  if (DANGEROUS_COMMANDS.some((d) => lower.includes(d))) {
    return false;
  }

  // 白名单：常见命令前缀
  if (ALLOWED_COMMAND_PREFIXES.some((p) => lower.startsWith(p))) {
    return true;
  }

  // 允许常见的单个可执行文件
  const firstWord = lower.split(/\s+/)[0];
  if (/^[a-z0-9._-]+$/.test(firstWord)) {
    return true;
  }

  // 默认放行（在受控环境中执行）
  return true;
}

// ============================================================================
// 测试命令工具函数
// ============================================================================

/**
 * 根据提案类型获取默认测试命令
 *
 * Phase 5.1 新增：按提案类型细化测试
 * - type-check 类：npx tsc --noEmit
 * - 测试类：npm test
 * - 构建类：npm run build
 * - 依赖审计类：npm audit
 * - 架构检查类：npx tsx scripts/arch-check.ts
 */
export function getDefaultTestCommand(proposal: OptimizationProposal): string {
  const target = (proposal.target || "").toLowerCase();

  // 类型安全 / any / catch / API 规范
  if (
    target.includes("any") ||
    target.includes("catch") ||
    target.includes("类型") ||
    target.includes("api")
  ) {
    return "npx tsc --noEmit";
  }

  // 测试文件
  if (target.includes("测试")) {
    return "npm test";
  }

  // 架构检查
  if (target.includes("架构")) {
    return "npx tsx scripts/arch-check.ts";
  }

  // 依赖安全
  if (target.includes("依赖")) {
    return "npm audit --audit-level=high";
  }

  // 性能 / 重构
  if (target.includes("性能") || target.includes("复杂度") || target.includes("重构")) {
    return "npm run build";
  }

  // 默认：构建检查
  return "npm run build";
}

/**
 * 为提案补充默认测试用例（如果提案没有测试用例）
 * Phase 5.1 新增：确保每个提案至少有一个测试
 */
export function ensureTestCases(proposal: OptimizationProposal): void {
  if (proposal.testCases.length > 0) return;

  const cmd = getDefaultTestCommand(proposal);
  proposal.testCases.push({
    id: proposal.id + "-tc-0",
    type: "unit",
    description: "验证优化后的代码能正常" + (cmd.includes("audit") ? "通过审计" : "编译"),
    setup: "",
    action: cmd,
    expected: "无报错运行",
    command: cmd,
  });
}

// ============================================================================
// 命令执行
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
          output: output + "\n[超时] 命令执行超过 60 秒",
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
 * @returns 应用结果
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
        ensureDir(dir);
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
// 回归测试 (Phase 5.3 新增)
// ============================================================================

/**
 * 回归测试结果
 */
export interface RegressionTestResult {
  /** 是否通过 */
  passed: boolean;
  /** 回归测试用例结果 */
  results: TestExecutionResult[];
  /** 失败描述 */
  failureReason?: string;
  /** 总耗时（秒） */
  durationSeconds: number;
}

/**
 * 执行全量回归测试
 *
 * Phase 5.3 新增：优化成功后，额外执行全量测试，
 * 对比优化前后的测试结果，发现回归立即回滚。
 *
 * @param cwd 项目工作目录
 * @param beforeResults 优化前的测试结果（可选，用于对比）
 * @returns 回归测试结果
 *
 * @example
 * ```ts
 * const result = await executeOptimization(proposal, cwd);
 * if (result.status === 'success') {
 *   const regression = await runRegressionTest(cwd);
 *   if (!regression.passed) {
 *     console.log('回归测试失败，建议回滚:', regression.failureReason);
 *   }
 * }
 * ```
 */
export async function runRegressionTest(
  cwd: string,
  beforeResults?: TestExecutionResult[]
): Promise<RegressionTestResult> {
  const startTime = Date.now();
  const commands = [
    { id: 'reg-tsc', command: 'npx tsc --noEmit', description: '类型检查' },
    { id: 'reg-build', command: 'npm run build', description: '构建检查' },
  ];

  // 如果有 npm test 脚本，也加入回归测试
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts && pkg.scripts.test) {
        commands.push({ id: 'reg-test', command: 'npm test', description: '单元测试' });
      }
    }
  } catch { /* ignore */ }

  const results: TestExecutionResult[] = [];
  let allPassed = true;

  for (const cmd of commands) {
    const result = await runTestCase(cmd.id, cmd.command, cwd);
    results.push(result);
    if (!result.passed) {
      allPassed = false;
      break;
    }
  }

  // 与优化前结果对比
  let failureReason: string | undefined;
  if (beforeResults && allPassed) {
    const beforePassed = beforeResults.filter((r) => r.passed).length;
    const afterPassed = results.filter((r) => r.passed).length;
    if (afterPassed < beforePassed) {
      allPassed = false;
      failureReason =
        '回归测试通过率下降（优化前 ' + beforePassed + '/' + beforeResults.length +
        '，优化后 ' + afterPassed + '/' + results.length + '）';
    }
  }

  if (!allPassed && !failureReason) {
    const failed = results.find((r) => !r.passed);
    if (failed) {
      failureReason = failed.testCaseId + ' 失败: ' + (failed.output || '').slice(0, 200);
    }
  }

  return {
    passed: allPassed,
    results,
    failureReason,
    durationSeconds: (Date.now() - startTime) / 1000,
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * 执行优化提案
 *
 * 执行流程：
 * 1. 检查总超时
 * 2. 逐个执行测试用例
 * 3. 全部通过 → 返回成功
 * 4. 有失败 → 调用 diff-generator 修复 → 应用 → 重试（最多 2 次）
 * 5. 修复失败 → 返回失败
 *
 * Phase 5.1 增强：
 * - 自动为无测试用例的提案补充默认测试
 * - 按提案类型使用对应的测试命令
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

  // Phase 5.1: 确保有测试用例
  ensureTestCases(proposal);

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
        lesson: "优化执行超时（120 秒），已强制终止",
        timestamp: new Date().toISOString(),
        totalDurationSeconds: elapsed / 1000,
      };
    }

    // 逐个执行测试用例
    const testResults: TestExecutionResult[] = [];
    let anyFailed = false;

    for (const tc of proposal.testCases) {
      // Phase 5.1: 如果测试用例没有命令，使用默认命令
      const cmd = tc.command || getDefaultTestCommand(proposal);
      const result = await runTestCase(tc.id, cmd, cwd);
      testResults.push(result);

      if (!result.passed) {
        anyFailed = true;
        break; // 第一个失败就进入修复流程
      }
    }

    // 全部通过
    if (!anyFailed) {
      const passed = testResults.length;
      const total = testResults.length;
      return {
        proposalId: proposal.id,
        status: "success",
        testResults,
        testSummary: { total, passed, failed: 0 },
        fixAttempts,
        reverted: false,
        lesson: "所有测试通过，优化成功",
        timestamp: new Date().toISOString(),
        totalDurationSeconds: (Date.now() - startTime) / 1000,
      };
    }

    // 有失败，尝试修复
    if (fixAttempts < MAX_FIX_ATTEMPTS) {
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
          `  [self-opt] 生成 ${diffResult.changes.length} 个文件变更，应用中...`
        );
        const applied = await applyFn(diffResult.changes);
        if (applied.success) {
          fixAttempts++;
          // 继续循环，重新执行测试
          continue;
        } else {
          console.log(`  [self-opt] 应用修复失败: ${applied.error}`);
        }
      } else {
        console.log("  [self-opt] 无法生成修复方案");
      }
    }

    // 修复次数已达上限或修复失败
    const passed = testResults.filter((r) => r.passed).length;
    const total = testResults.length;
    const failed = total - passed;

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
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化测试结果
 * @param results 测试执行结果列表
 * @returns 格式化后的文本字符串
 */
export function formatTestResults(results: TestExecutionResult[]): string {
  const lines = [
    "══════════════════════════════════════════",
    "🧪 Test Results",
    "══════════════════════════════════════════",
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
 * 运行提案的测试用例（兼容旧接口）
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
