/**
 * @file diff-generator.ts — Diff Generator 差异生成器
 * @description
 *   基于测试失败结果和当前代码，生成代码修复补丁。
 *   Phase 4 核心组件：连接 test runner 和 LLM 的桥梁。
 *
 *   工作流程：
 *   1. 分析测试失败输出，定位问题
 *   2. 读取相关源文件
 *   3. 调用 LLM 生成修复补丁
 *   4. 返回可应用的 FileChange[]
 *
 * @module core/self-opt/diff-generator
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { FileChange, TestExecutionResult, OptimizationProposal } from "./types.js";
import { client } from "../agent.js";

// ============================================================================
// 失败分析
// ============================================================================

interface FailureAnalysis {
  /** 失败原因摘要 */
  summary: string;
  /** 可能涉及的文件 */
  suspectFiles: string[];
  /** 建议修复方向 */
  fixSuggestions: string[];
}

/**
 * 分析测试失败，提取关键信息
 */
function analyzeFailures(
  results: TestExecutionResult[],
  proposal: OptimizationProposal,
): FailureAnalysis {
  const failed = results.filter((r) => !r.passed);
  const suspectFiles = new Set<string>();
  const fixSuggestions: string[] = [];

  for (const r of failed) {
    const output = r.output.toLowerCase();

    // 编译错误 → 语法/类型问题
    if (output.includes("error ts") || output.includes("类型")) {
      fixSuggestions.push("修复 TypeScript 编译错误（类型不匹配、语法错误）");
    }
    // 运行时错误 → 逻辑问题
    if (output.includes("referenceerror") || output.includes("undefined")) {
      fixSuggestions.push("修复未定义引用（可能缺少 import 或变量名错误）");
    }
    if (output.includes("typeerror")) {
      fixSuggestions.push("修复类型错误（检查函数签名和参数类型）");
    }
    // 测试断言失败 → 逻辑偏差
    if (output.includes("assert") || output.includes("expected") || output.includes("expect")) {
      fixSuggestions.push("修复测试断言（检查预期值与实际值）");
    }
    // 超时
    if (output.includes("timeout") || output.includes("超时")) {
      fixSuggestions.push("修复性能问题或无限循环");
    }
    // 安全拦截
    if (output.includes("安全拦截")) {
      fixSuggestions.push("修改测试命令，移除危险操作");
    }
    // 文件不存在
    if (output.includes("enoent") || output.includes("找不到") || output.includes("not found")) {
      fixSuggestions.push("创建缺失的文件或目录");
    }

    // 从提案中提取相关文件
    for (const tc of proposal.testCases) {
      if (tc.id === r.testCaseId && tc.testFilePath) {
        suspectFiles.add(tc.testFilePath);
      }
    }
  }

  // 从提案目标中提取文件
  if (proposal.files.length > 0) {
    for (const f of proposal.files) suspectFiles.add(f.path);
  }

  // 如果没有具体线索，给通用建议
  if (fixSuggestions.length === 0) {
    fixSuggestions.push("检查代码逻辑，确保功能正确");
  }

  return {
    summary: `${failed.length}/${results.length} 测试失败`,
    suspectFiles: [...suspectFiles],
    fixSuggestions,
  };
}

// ============================================================================
// LLM 驱动的补丁生成
// ============================================================================

/**
 * 调用 LLM 生成修复补丁
 */
async function generateFixWithLLM(
  proposal: OptimizationProposal,
  failureAnalysis: FailureAnalysis,
  srcDir: string,
): Promise<FileChange[]> {
  // 构建上下文：读取相关文件内容
  const fileContexts: string[] = [];
  for (const filePath of failureAnalysis.suspectFiles.slice(0, 5)) {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(srcDir, filePath);
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        fileContexts.push(`// File: ${filePath}\n${content.slice(0, 3000)}\n`);
      }
    } catch {
      // 文件不存在，可能是需要创建的新文件
      fileContexts.push(`// File: ${filePath} (DOES NOT EXIST - needs to be created)\n`);
    }
  }

  // 如果提案已有文件变更计划，也加入上下文
  if (proposal.files.length > 0) {
    for (const f of proposal.files) {
      fileContexts.push(
        `// Planned change: ${f.action} ${f.path}\n// ${f.description || ""}\n`,
      );
    }
  }

  const systemPrompt = `你是资深 TypeScript 工程师。用户会提供代码文件和测试失败信息，
请分析失败原因并生成修复补丁。

规则：
1. 只修改必要的部分，最小化变更
2. 保持原有功能不变
3. 修复后必须能通过 npm run build
4. 输出格式为 JSON 数组，每个元素包含 path, action, content, description
5. 如果是新文件，action 为 "create"；修改已有文件为 "modify"
6. 返回纯 JSON，不要包裹在 markdown 代码块中`;

  const userPrompt = `## 优化提案
- 目标: ${proposal.target}
- 类型: ${proposal.type}
- 描述: ${proposal.description}

## 失败分析
${failureAnalysis.summary}
${failureAnalysis.fixSuggestions.map((s) => `- ${s}`).join("\n")}

## 相关文件
${fileContexts.join("\n---\n")}

请生成修复补丁（JSON 数组格式）。`;

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
      // 清理可能的 markdown 包裹
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
// 主入口
// ============================================================================

export interface DiffGenerateResult {
  /** 生成的文件变更 */
  changes: FileChange[];
  /** 分析摘要 */
  analysisSummary: string;
  /** 是否成功生成 */
  success: boolean;
}

/**
 * 生成修复补丁
 *
 * @param proposal 当前提案
 * @param testResults 失败的测试结果
 * @param srcDir 源码目录
 * @returns 修复补丁
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
    };
  }

  const changes = await generateFixWithLLM(proposal, analysis, srcDir);

  return {
    changes,
    analysisSummary: analysis.summary,
    success: changes.length > 0,
  };
}
