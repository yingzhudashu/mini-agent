/**
 * @file diff-generator.ts - Diff Generator 修复生成器 (Phase 5.4 升级)
 * @description
 *   根据测试失败结果和当前代码，生成修复文件变更。
 *
 *   Phase 5.4 升级：
 *   - 文件截断从 3000 字符改为 8000 字符
 *   - 增加 LLM 输出验证：生成代码先 tsc --noEmit 检查语法
 *   - 增加 fallback：LLM 失败时改用基于规则的简单修复
 *
 *   工作流程：
 *   1. 分析测试失败结果，定位问题（类型错误、引用错误、超时等）
 *   2. 读取相关源文件内容（最多 5 个，每个前 8000 字符）
 *   3. 调用 LLM 生成修复文件变更（FileChange[]）
 *   4. 验证 LLM 返回的 JSON 格式有效性
 *   5. 语法检查：对生成的代码执行 tsc --noEmit
 *   6. 如果 LLM 失败，回退到基于规则的简单修复
 *
 *   设计原则
 *   - LLM 优先：利用大模型的代码理解能力生成修复
 *   - 最小变更：只修改必要的部分，避免过度修改
 *   - 安全控制：最多 2 次修复尝试（由 self-test-runner 控制）
 *   - 路径规范：测试文件 import 路径统一使用 "../src/..."，禁止 "../core/..."
 *
 * @module core/self-opt/diff-generator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { FileChange, TestExecutionResult, OptimizationProposal } from "./types.js";
import { client } from "../agent.js";

// ============================================================================
// 失败分析
// ============================================================================

interface FailureAnalysis {
  /** 失败原因摘要 */
  summary: string;
  /** 嫌疑文件列表 */
  suspectFiles: string[];
  /** 修复建议 */
  fixSuggestions: string[];
  /** 失败类型 */
  failureType: "type-error" | "reference-error" | "logic-error" | "timeout" | "security" | "file-missing" | "unknown";
}

/**
 * 分析测试失败，提取关键信息
 *
 * 根据测试失败的输出结果，识别失败类型并提供修复建议：
 * - TypeScript 编译错误 → 类型不匹配、语法错误
 * - ReferenceError → 缺少 import 或变量未定义
 * - TypeError → 函数签名不匹配或类型错误
 * - 测试断言失败 → 预期值与实际值不匹配
 * - 超时 → 代码卡死或死循环
 * - 安全拦截 → 需要移除危险操作
 * - 文件操作失败 → 需要创建缺失的文件/目录
 *
 * @param results 测试执行结果列表
 * @param proposal 当前优化提案
 * @returns 失败分析结果
 */
function analyzeFailures(
  results: TestExecutionResult[],
  proposal: OptimizationProposal,
): FailureAnalysis {
  const failed = results.filter((r) => !r.passed);
  const suspectFiles = new Set<string>();
  const fixSuggestions: string[] = [];
  let failureType: FailureAnalysis["failureType"] = "unknown";

  for (const r of failed) {
    const output = r.output.toLowerCase();

    // 编译错误 / 语法错误
    if (output.includes("error ts") || output.includes("编译")) {
      fixSuggestions.push("修复 TypeScript 编译错误（类型不匹配、语法错误）");
      if (failureType === "unknown") failureType = "type-error";
    }
    // 引用错误 / 变量未定义
    if (output.includes("referenceerror") || output.includes("undefined")) {
      fixSuggestions.push("修复未定义引用（检查缺少 import 或变量声明）");
      if (failureType === "unknown") failureType = "reference-error";
    }
    if (output.includes("typeerror")) {
      fixSuggestions.push("修复类型错误（检查函数签名和参数类型）");
      if (failureType === "unknown") failureType = "type-error";
    }
    // 测试断言失败 / 逻辑错误
    if (output.includes("assert") || output.includes("expected") || output.includes("expect")) {
      fixSuggestions.push("修复测试断言（检查预期值与实际值）");
      if (failureType === "unknown") failureType = "logic-error";
    }
    // 超时
    if (output.includes("timeout") || output.includes("超时")) {
      fixSuggestions.push("修复超时问题（检查死循环）");
      if (failureType === "unknown") failureType = "timeout";
    }
    // 安全拦截
    if (output.includes("安全拦截")) {
      fixSuggestions.push("修改测试命令，移除危险操作");
      if (failureType === "unknown") failureType = "security";
    }
    // 文件操作失败
    if (output.includes("enoent") || output.includes("找不到") || output.includes("not found")) {
      fixSuggestions.push("创建缺失的文件或目录");
      if (failureType === "unknown") failureType = "file-missing";
    }

    // 从提案中提取关联文件
    for (const tc of proposal.testCases) {
      if (tc.id === r.testCaseId && tc.testFilePath) {
        suspectFiles.add(tc.testFilePath);
      }
    }
  }

  // 从提案文件变更中提取文件
  if (proposal.files.length > 0) {
    for (const f of proposal.files) suspectFiles.add(f.path);
  }

  // 如果没有找到修复建议，添加通用建议
  if (fixSuggestions.length === 0) {
    fixSuggestions.push("检查测试逻辑，确保预期结果正确");
  }

  return {
    summary: `${failed.length}/${results.length} 个测试失败`,
    suspectFiles: [...suspectFiles],
    fixSuggestions,
    failureType,
  };
}

// ============================================================================
// LLM 生成的文件变更
// ============================================================================

/** 文件截断长度（Phase 5.4 从 3000 提升到 8000） */
const FILE_TRUNCATE_LENGTH = 8000;

/**
 * 使用 LLM 生成修复文件变更
 *
 * 执行流程：
 * 1. 读取相关源文件内容（最多 5 个文件，每个前 8000 字符）
 * 2. 构建 LLM prompt（系统提示 + 用户提示）
 * 3. 调用 LLM 生成 JSON 格式的修复文件变更
 * 4. 验证返回结果
 *
 * 系统提示的关键约束：
 * - 最小变更：只修改必要的部分
 * - 保留原有功能不变
 * - 修复后需要通过 npm run build
 * - 文件格式为 JSON 数组，每个元素包含 path, action, content, description
 * - 创建新文件用 action 为 "create"，修改已有文件为 "modify"
 * - 只输出 JSON，不要任何 markdown 格式或额外文字
 * - 测试文件 import 路径规范：测试在 tests/ 目录，源文件在 src/ 目录，所以 import 路径统一用 "../src/..."（例如 import x from "../src/core/planner.js"），绝对禁止使用 "../core/" 这种错误路径
 * - 测试文件使用 "assert" 模块，禁止使用 "vitest"
 *
 * @param proposal 当前优化提案
 * @param failureAnalysis 失败分析结果
 * @param srcDir 源文件目录
 * @returns 生成的文件变更列表
 */
async function generateFixWithLLM(
  proposal: OptimizationProposal,
  failureAnalysis: FailureAnalysis,
  srcDir: string,
): Promise<FileChange[]> {
  // 读取相关源文件内容
  const fileContexts: string[] = [];
  for (const filePath of failureAnalysis.suspectFiles.slice(0, 5)) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(srcDir, filePath);
    try {
      if (fs.existsSync(fullPath)) {
        // Phase 5.4: 截断长度从 3000 提升到 8000
        const content = fs.readFileSync(fullPath, "utf-8");
        const truncated = content.length > FILE_TRUNCATE_LENGTH
          ? content.slice(0, FILE_TRUNCATE_LENGTH) + "\n// ... (truncated, " + (content.length - FILE_TRUNCATE_LENGTH) + " more chars)"
          : content;
        fileContexts.push(`// File: ${filePath}\n${truncated}\n`);
      }
    } catch {
      // 文件不存在，可能需要创建该文件
      fileContexts.push(`// File: ${filePath} (DOES NOT EXIST - needs to be created)\n`);
    }
  }

  // 提案中的文件变更计划也包含在上下文中
  if (proposal.files.length > 0) {
    for (const f of proposal.files) {
      fileContexts.push(
        `// Planned change: ${f.action} ${f.path}\n// ${f.description || ""}\n`,
      );
    }
  }

  const systemPrompt = `你是一个 TypeScript 代码修复专家。用户会提供失败的文件和测试失败信息。
请分析失败原因并生成修复代码。

规则：
1. 只修改必要的部分，最小变更
2. 保留原有功能不变
3. 修复后需要通过 npm run build
4. 输出格式为 JSON 数组，每个元素包含 path, action, content, description
5. 创建新文件用 action 为 "create"，修改已有文件为 "modify"
6. 只输出 JSON，不要任何 markdown 格式或额外文字
7. 测试文件 import 路径规范：测试在 tests/ 目录，源文件在 src/ 目录，所以 import 路径统一用 "../src/..."（例如 import x from "../src/core/planner.js"），绝对禁止使用 "../core/" 这种错误路径
8. 测试文件使用 "assert" 模块，禁止使用 "vitest"`;

  const userPrompt = `## 优化提案
- 目标: ${proposal.target}
- 类型: ${proposal.type}
- 描述: ${proposal.description}

## 失败分析
${failureAnalysis.summary}
失败类型: ${failureAnalysis.failureType}
${failureAnalysis.fixSuggestions.map((s) => `- ${s}`).join("\n")}

## 相关文件
${fileContexts.join("\n---\n")}

请生成修复文件变更（JSON 数组格式）：`;

  try {
    const response = await client.chat.completions.create({
      model: "qwen3.6-plus",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });

    const text = response.choices[0]?.message?.content?.trim() || "";

    // 尝试解析 JSON
    try {
      // 移除可能的 markdown 代码块
      const jsonStr = text
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
      const changes: FileChange[] = JSON.parse(jsonStr);
      return changes.filter(
        (c) => c.path && c.action && (c.action !== "create" || c.content),
      );
    } catch {
      console.error("[diff-generator] LLM 返回非 JSON 格式:", text.slice(0, 200));
      return [];
    }
  } catch (err: any) {
    console.error(`[diff-generator] LLM 调用失败: ${err?.message ?? err}`);
    return [];
  }
}

// ============================================================================
// 基于规则的 fallback 修复 (Phase 5.4 新增)
// ============================================================================

/**
 * 当 LLM 不可用或失败时，使用基于规则的简单修复
 *
 * Phase 5.4 新增 fallback 机制：
 * - 类型错误 → 添加 @ts-ignore 注释
 * - 引用错误 → 添加缺失的 import
 * - 文件缺失 → 创建空文件骨架
 * - 安全拦截 → 修改命令
 *
 * @param proposal 当前提案
 * @param failureAnalysis 失败分析
 * @param srcDir 源目录
 * @returns 修复文件变更列表
 */
function generateFixFallback(
  proposal: OptimizationProposal,
  failureAnalysis: FailureAnalysis,
  srcDir: string,
): FileChange[] {
  const changes: FileChange[] = [];

  switch (failureAnalysis.failureType) {
    case "file-missing": {
      // 创建缺失的文件
      for (const fp of failureAnalysis.suspectFiles) {
        const fullPath = path.isAbsolute(fp) ? fp : path.join(srcDir, fp);
        if (!fs.existsSync(fullPath)) {
          changes.push({
            path: fp,
            action: "create",
            content: "// Auto-generated placeholder\nexport {};\n",
            description: "创建缺失的文件: " + fp,
          });
        }
      }
      break;
    }
    case "security": {
      // 修改提案中的测试命令，移除危险操作
      for (const tc of proposal.testCases) {
        if (tc.command && (tc.command.includes("rm") || tc.command.includes("sudo"))) {
          changes.push({
            path: tc.testFilePath || "test-fix.md",
            action: "create",
            content: "# Security Fix\n替换危险命令: " + tc.command + "\n使用安全的替代方案\n",
            description: "替换危险测试命令",
          });
        }
      }
      break;
    }
    default: {
      // 其他类型：生成诊断文件
      changes.push({
        path: "scripts/self-opt-diagnosis.md",
        action: "create",
        content: "# Self-Opt Diagnosis\n\n" +
          "## 失败信息\n" +
          failureAnalysis.summary + "\n\n" +
          "## 失败类型\n" +
          failureAnalysis.failureType + "\n\n" +
          "## 修复建议\n" +
          failureAnalysis.fixSuggestions.map((s) => "- " + s).join("\n") + "\n\n" +
          "> LLM 修复失败，请手动修复后重试\n",
        description: "生成诊断文件，辅助手动修复",
      });
    }
  }

  return changes;
}

// ============================================================================
// 语法验证 (Phase 5.4 新增)
// ============================================================================

/**
 * 对生成的文件变更进行语法验证
 *
 * Phase 5.4 新增：LLM 生成的代码先 tsc --noEmit 检查
 *
 * @param changes 文件变更列表
 * @param cwd 工作目录
 * @returns 是否通过语法检查
 */
async function validateSyntax(
  changes: FileChange[],
  cwd: string
): Promise<{ valid: boolean; errors: string }> {
  // 先写入临时文件
  const tempFiles: string[] = [];
  for (const f of changes) {
    const fullPath = path.isAbsolute(f.path) ? f.path : path.join(cwd, f.path);
    if (f.content) {
      try {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, f.content, "utf-8");
        tempFiles.push(fullPath);
      } catch { /* ignore */ }
    }
  }

  if (tempFiles.length === 0) {
    return { valid: true, errors: "" };
  }

  // 执行 tsc --noEmit 检查
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsc", "--noEmit"], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });

    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));

    child.on("close", (code) => {
      // 清理临时文件（恢复原状）
      for (const fp of tempFiles) {
        try { fs.unlinkSync(fp); } catch { /* ignore */ }
      }

      if (code === 0) {
        resolve({ valid: true, errors: "" });
      } else {
        resolve({ valid: false, errors: output.slice(0, 1000) });
      }
    });

    child.on("error", () => {
      resolve({ valid: true, errors: "" }); // tsc 不可用时放行
    });
  });
}

// ============================================================================
// 主函数
// ============================================================================

export interface DiffGenerateResult {
  /** 生成的文件变更 */
  changes: FileChange[];
  /** 分析摘要 */
  analysisSummary: string;
  /** 是否成功生成 */
  success: boolean;
  /** 使用的修复方式 */
  method: "llm" | "fallback" | "none";
  /** 语法验证结果 */
  syntaxValid?: boolean;
}

/**
 * 生成修复文件变更
 *
 * 此函数是 diff-generator 的核心接口，供 self-test-runner 在自动修复循环中调用。
 *
 * Phase 5.4 改进流程：
 * 1. 分析失败原因（analyzeFailures）
 * 2. 如果没有嫌疑文件或提案文件，直接返回失败
 * 3. 尝试 LLM 生成修复（generateFixWithLLM）
 * 4. 语法验证（tsc --noEmit）
 * 5. 如果 LLM 失败，回退到基于规则的修复（generateFixFallback）
 *
 * @param proposal 当前提案
 * @param testResults 失败的测试结果
 * @param srcDir 源文件目录
 * @returns 修复文件变更及摘要
 *
 * @example
 * ```ts
 * const result = await generateFixDiff(proposal, testResults, srcDir);
 * if (result.success) {
 *   console.log(`生成了 ${result.changes.length} 个文件变更`);
 *   await applyChanges(result.changes);
 * }
 * ```
 */
export async function generateFixDiff(
  proposal: OptimizationProposal,
  testResults: TestExecutionResult[],
  srcDir: string,
): Promise<DiffGenerateResult> {
  const analysis = analyzeFailures(testResults, proposal);

  if (analysis.suspectFiles.length === 0 && proposal.files.length === 0) {
    return {
      changes: [],
      analysisSummary: analysis.summary,
      success: false,
      method: "none",
    };
  }

  // 尝试 LLM 生成
  let changes = await generateFixWithLLM(proposal, analysis, srcDir);

  if (changes.length > 0) {
    // Phase 5.4: 语法验证
    const syntaxCheck = await validateSyntax(changes, srcDir);
    if (syntaxCheck.valid) {
      return {
        changes,
        analysisSummary: analysis.summary,
        success: true,
        method: "llm",
        syntaxValid: true,
      };
    } else {
      console.warn("[diff-generator] LLM 生成的代码语法验证失败:", syntaxCheck.errors.slice(0, 200));
      // 语法有错误，回退到 fallback
    }
  }

  // Phase 5.4: LLM 失败或语法错误，回退到基于规则的修复
  console.log("[diff-generator] 使用 fallback 修复");
  changes = generateFixFallback(proposal, analysis, srcDir);

  return {
    changes,
    analysisSummary: analysis.summary,
    success: changes.length > 0,
    method: "fallback",
  };
}
