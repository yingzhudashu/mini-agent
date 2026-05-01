/**
 * @file self-opt.ts — Self-Optimization 工具集
 * @description
 *   提供自我优化能力的工具：
 *   - self_inspect: 自我审视，分析当前架构和代码质量
 *   - external_research: 搜索外部先进架构和论文
 *   - generate_proposal: 生成优化提案（含测试用例）
 *   - implement_change: 实施代码变更
 *   - run_tests: 运行测试验证
 *   - git_snapshot: Git 快照管理（保存/回滚）
 *
 *   权限设计：
 *   - self_inspect / external_research → sandbox（只读）
 *   - generate_proposal → sandbox（只生成提案）
 *   - implement_change → require-confirm（修改代码）
 *   - run_tests → allowlist（运行测试命令）
 *   - git_snapshot → require-confirm（git 操作）
 *
 * @module tools/self-opt
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, ToolResult } from "../core/types.js";
import type {
  InspectionReport,
  ResearchReport,
  OptimizationProposal,
  OptimizationResult,
} from "../core/self-opt/types.js";
import { inspectSelf } from "../core/self-opt/inspector.js";
import { researchExternal } from "../core/self-opt/researcher.js";

// ============================================================================
// 工具: self_inspect — 自我审视
// ============================================================================

const selfInspectTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "self_inspect",
      description: "分析当前 Agent 的架构完整性、代码质量和痛点，生成自我审视报告",
      parameters: {
        type: "object",
        properties: {
          srcDir: {
            type: "string",
            description: "项目 src/ 目录路径（默认自动检测）",
          },
          detailed: {
            type: "boolean",
            description: "是否输出详细报告（包含每个模块的完整分析）",
          },
        },
        required: [],
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    try {
      const srcDir = (args.srcDir as string) || path.resolve(ctx.cwd, "src");
      const detailed = (args.detailed as boolean) ?? false;

      if (!fs.existsSync(srcDir)) {
        return { success: false, content: `错误: src 目录不存在: ${srcDir}` };
      }

      const report = await inspectSelf(srcDir);

      // 格式化输出
      const lines: string[] = [
        "═══════════════════════════════════════════════════",
        "🔍 Self-Inspection Report",
        "═══════════════════════════════════════════════════",
        `📅 时间: ${report.timestamp}`,
        `📦 版本: v${report.version}`,
        "",
        "📊 代码质量指标:",
      ];

      for (const m of report.qualityMetrics) {
        const icon = m.passed ? "✅" : "⚠️";
        lines.push(`  ${icon} ${m.name}: ${m.value}${m.target ? ` (目标: ${m.target})` : ""}`);
        if (m.note) lines.push(`     → ${m.note}`);
      }

      lines.push("");
      lines.push("🏗️ 架构完整性检查:");
      const failedChecks = report.architectureChecks.filter((c) => !c.passed);
      const passedCount = report.architectureChecks.length - failedChecks.length;
      lines.push(`  ✅ 通过: ${passedCount}/${report.architectureChecks.length}`);

      if (failedChecks.length > 0) {
        lines.push("  ❌ 未通过:");
        for (const c of failedChecks) {
          lines.push(`    - ${c.name}: ${c.recommendation || c.details}`);
        }
      }

      lines.push("");
      lines.push("⚡ 痛点列表:");
      if (report.painPoints.length === 0) {
        lines.push("  暂无发现");
      } else {
        for (const p of report.painPoints) {
          const sev = p.severity === "high" ? "🔴" : p.severity === "medium" ? "🟡" : "🟢";
          lines.push(`  ${sev} ${p.description}`);
        }
      }

      lines.push("");
      lines.push("💡 优化建议:");
      for (const s of report.suggestions) {
        lines.push(`  → ${s}`);
      }

      lines.push("");
      lines.push("📝 总评:");
      lines.push(`  ${report.summary}`);

      // 详细模式下附加模块分析
      if (detailed) {
        lines.push("");
        lines.push("═══════════════════════════════════════════════════");
        lines.push("📁 模块详细分析");
        lines.push("═══════════════════════════════════════════════════");
        for (const m of report.moduleAnalysis) {
          lines.push(`\n📄 ${m.path}`);
          lines.push(`  代码行数: ${m.linesOfCode}`);
          lines.push(`  有测试: ${m.hasTests ? "✅" : "❌"}`);
          lines.push(`  导出数: ${m.exportsCount} | 导入数: ${m.importsCount}`);
          lines.push(`  复杂度: ${m.complexityScore}/10`);
          if (m.issues.length > 0) {
            lines.push(`  问题: ${m.issues.join("; ")}`);
          }
        }
      }

      return { success: true, content: lines.join("\n") };
    } catch (err: any) {
      return { success: false, content: `自我审视失败: ${err?.message ?? err}` };
    }
  },
  permission: "sandbox",
  help: "self_inspect — 分析当前 Agent 架构和代码质量",
  toolbox: "self_optimization",
};

// ============================================================================
// 工具: external_research — 外部调研
// ============================================================================

const externalResearchTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "external_research",
      description: "搜索 arXiv 论文和 GitHub 项目，调研当前先进的 Agent 架构和实现",
      parameters: {
        type: "object",
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
            description: "自定义搜索关键词（默认使用预定义列表）",
          },
          maxResults: {
            type: "number",
            description: "每个查询的最大结果数（默认 3）",
          },
        },
        required: [],
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    try {
      const queries = args.queries as string[] | undefined;
      const maxResults = (args.maxResults as number) ?? 3;

      const report = await researchExternal(queries, maxResults);

      const lines: string[] = [
        "═══════════════════════════════════════════════════",
        "🌐 External Research Report",
        "═══════════════════════════════════════════════════",
        `📅 时间: ${report.timestamp}`,
        `🔍 搜索词: ${report.searchQueries.join(", ")}`,
        `📦 找到资源: ${report.references.length} 个`,
        "",
        "🔬 提取的架构模式:",
      ];

      for (const p of report.extractedPatterns) {
        lines.push(`\n  ▸ ${p.name}`);
        lines.push(`    描述: ${p.description}`);
        lines.push(`    来源: ${p.sourceReferences.join("; ")}`);
        lines.push(`    适用性: ${p.applicability}`);
      }

      lines.push("");
      lines.push("📄 参考资源 (Top 10):");
      for (const ref of report.references.slice(0, 10)) {
        const icon = ref.type === "paper" ? "📑" : "💻";
        lines.push(`  ${icon} [${ref.type}] ${ref.title} (相关性: ${ref.relevance}/10)`);
        lines.push(`     URL: ${ref.url}`);
        if (ref.summary) lines.push(`     摘要: ${ref.summary.slice(0, 150)}...`);
      }

      lines.push("");
      lines.push("📝 总结:");
      lines.push(`  ${report.summary}`);

      return { success: true, content: lines.join("\n") };
    } catch (err: any) {
      return { success: false, content: `外部调研失败: ${err?.message ?? err}` };
    }
  },
  permission: "sandbox",
  help: "external_research — 搜索外部先进架构和论文",
  toolbox: "self_optimization",
};

// ============================================================================
// 工具: generate_proposal — 生成优化提案
// ============================================================================

const generateProposalTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "generate_proposal",
      description:
        "基于自我审视和外部调研结果，生成优化提案列表（含测试用例）。提案不会自动执行。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "优化目标（如：'添加缓存层'、'改进规划器'）",
          },
          type: {
            type: "string",
            enum: ["add", "remove", "modify", "refactor"],
            description: "优化类型",
          },
          description: {
            type: "string",
            description: "改动说明",
          },
          rationale: {
            type: "string",
            description: "优化依据（参考了哪些模式或论文）",
          },
          testCases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                description: { type: "string" },
                command: { type: "string" },
                expected: { type: "string" },
              },
            },
            description: "关联的测试用例",
          },
        },
        required: ["target", "description"],
      },
    },
  },
  handler: async (args): Promise<ToolResult> => {
    const target = (args.target as string) || "";
    const type = (args.type as string) || "add";
    const description = (args.description as string) || "";
    const rationale = (args.rationale as string) || "基于架构分析";

    const testCases = (args.testCases as any[]) || [];

    const proposal: OptimizationProposal = {
      id: `prop-${Date.now()}`,
      type: type as any,
      riskLevel: assessRisk(type as string, target),
      target,
      description,
      rationale,
      expectedBenefit: "提升架构质量和可维护性",
      files: [],
      dependencies: [],
      testCases: testCases.map((tc, i) => ({
        id: tc.id || `tc-${i}`,
        type: "unit" as const,
        description: tc.description || "",
        setup: "",
        action: tc.command || "",
        expected: tc.expected || "",
        command: tc.command || "",
      })),
    };

    const lines = [
      "═══════════════════════════════════════════════════",
      "📋 Optimization Proposal",
      "═══════════════════════════════════════════════════",
      `🆔 ID: ${proposal.id}`,
      `📌 类型: ${proposal.type}`,
      `⚠️ 风险等级: ${proposal.riskLevel}`,
      `🎯 目标: ${proposal.target}`,
      `📝 说明: ${proposal.description}`,
      `📖 依据: ${proposal.rationale}`,
      `💡 预期收益: ${proposal.expectedBenefit}`,
    ];

    if (testCases.length > 0) {
      lines.push("");
      lines.push("🧪 测试用例:");
      for (const tc of proposal.testCases) {
        lines.push(`  - [${tc.id}] ${tc.description}`);
        lines.push(`    命令: ${tc.command}`);
        lines.push(`    预期: ${tc.expected}`);
      }
    }

    lines.push("");
    lines.push("⚠️ 此提案尚未执行。使用 implement_change 工具实施。");

    return { success: true, content: lines.join("\n") };
  },
  permission: "sandbox",
  help: "generate_proposal — 生成优化提案（不执行）",
  toolbox: "self_optimization",
};

/** 评估风险等级 */
function assessRisk(type: string, target: string): "low" | "medium" | "high" | "destructive" {
  const destructive = ["delete", "remove core", "overwrite config", ".env"];
  const high = ["modify core", "refactor agent", "modify planner", "change registry"];
  const medium = ["modify tool", "add dependency", "refactor"];

  const lower = `${type} ${target}`.toLowerCase();

  for (const k of destructive) if (lower.includes(k)) return "destructive";
  for (const k of high) if (lower.includes(k)) return "high";
  for (const k of medium) if (lower.includes(k)) return "medium";
  return "low";
}

// ============================================================================
// 工具: implement_change — 实施变更
// ============================================================================

const implementChangeTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "implement_change",
      description: "实施优化提案中的代码变更。执行前会创建 Git 快照。",
      parameters: {
        type: "object",
        properties: {
          proposalId: {
            type: "string",
            description: "提案 ID",
          },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                action: { type: "string", enum: ["create", "modify", "delete"] },
                content: { type: "string" },
              },
              required: ["path", "action"],
            },
            description: "要变更的文件列表",
          },
        },
        required: ["files"],
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const files = (args.files as any[]) || [];
    const projectRoot = path.resolve(ctx.cwd);

    // ── 创建 Git 快照 ──
    let snapshotHash = "";
    try {
      snapshotHash = await gitSnapshot(projectRoot, "self-opt: pre-change snapshot");
    } catch (err: any) {
      // Git 不可用，继续执行但记录警告
      snapshotHash = `warning: ${err.message}`;
    }

    const results: string[] = [];

    for (const file of files) {
      const filePath = path.resolve(projectRoot, file.path);
      const relativePath = file.path;

      try {
        if (file.action === "create" || file.action === "modify") {
          if (!file.content) {
            results.push(`❌ ${relativePath}: 缺少 content`);
            continue;
          }
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, file.content, "utf-8");
          results.push(`✅ ${relativePath}: ${file.action === "create" ? "已创建" : "已修改"}`);
        } else if (file.action === "delete") {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            results.push(`✅ ${relativePath}: 已删除`);
          } else {
            results.push(`⚠️ ${relativePath}: 文件不存在，跳过`);
          }
        }
      } catch (err: any) {
        results.push(`❌ ${relativePath}: ${err.message}`);
      }
    }

    const lines = [
      "═══════════════════════════════════════════════════",
      "🔧 Change Implementation",
      "═══════════════════════════════════════════════════",
      `📸 Git 快照: ${snapshotHash}`,
      "",
      ...results,
      "",
      "💡 变更已实施。请使用 run_tests 验证。",
    ];

    return {
      success: !results.some((r) => r.startsWith("❌")),
      content: lines.join("\n"),
    };
  },
  permission: "require-confirm",
  help: "implement_change — 实施代码变更（需确认）",
  toolbox: "self_optimization",
};

// ============================================================================
// 工具: run_tests — 运行测试
// ============================================================================

const runTestsTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "run_tests",
      description: "运行测试验证变更是否正确",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "测试命令（如: npm run build && npm test）",
          },
          timeout: {
            type: "number",
            description: "超时时间（秒，默认 60）",
          },
        },
        required: ["command"],
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const command = (args.command as string) || "";
    const timeout = ((args.timeout as number) ?? 60) * 1000;

    // 安全检查：禁止危险命令
    const dangerous = ["rm -rf /", "mkfs", "dd if=", "chmod 777 /", "sudo rm"];
    for (const d of dangerous) {
      if (command.includes(d)) {
        return { success: false, content: `❌ 禁止执行危险命令: ${d}` };
      }
    }

    return new Promise((resolve) => {
      const [cmd, ...restArgs] = command.split(/\s+/);
      const child = spawn(cmd, restArgs, {
        cwd: ctx.cwd,
        shell: true,
        timeout,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (code) => {
        const success = code === 0;
        const lines = [
          "═══════════════════════════════════════════════════",
          `🧪 Test Result: ${success ? "✅ PASS" : "❌ FAIL"}`,
          "═══════════════════════════════════════════════════",
          `命令: ${command}`,
          `退出码: ${code}`,
          "",
          "stdout:",
          stdout.slice(0, 3000) || "(空)",
        ];

        if (stderr) {
          lines.push("", "stderr:", stderr.slice(0, 2000));
        }

        resolve({ success, content: lines.join("\n") });
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          content: `❌ 测试执行错误: ${err.message}`,
        });
      });
    });
  },
  permission: "allowlist",
  help: "run_tests — 运行测试验证变更",
  toolbox: "self_optimization",
};

// ============================================================================
// 工具: git_snapshot — Git 快照管理
// ============================================================================

const gitSnapshotTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "git_snapshot",
      description: "创建或管理 Git 快照（用于回滚）",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "list", "revert"],
            description: "操作类型",
          },
          message: {
            type: "string",
            description: "commit message（创建快照时）",
          },
          commitHash: {
            type: "string",
            description: "要回滚到的 commit hash",
          },
        },
        required: ["action"],
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const action = (args.action as string) || "create";
    const projectRoot = path.resolve(ctx.cwd);

    try {
      if (action === "create") {
        const message = (args.message as string) || "self-opt: snapshot";
        const hash = await gitSnapshot(projectRoot, message);
        return { success: true, content: `✅ Git 快照已创建: ${hash}` };
      }

      if (action === "list") {
        const log = await gitLog(projectRoot, 10);
        return { success: true, content: `Git 历史:\n${log}` };
      }

      if (action === "revert") {
        const commitHash = (args.commitHash as string) || "HEAD";
        const result = await gitRevert(projectRoot, commitHash);
        return { success: true, content: result };
      }

      return { success: false, content: `未知操作: ${action}` };
    } catch (err: any) {
      return { success: false, content: `Git 操作失败: ${err.message}` };
    }
  },
  permission: "require-confirm",
  help: "git_snapshot — 创建/列出/回滚 Git 快照",
  toolbox: "self_optimization",
};

// ============================================================================
// Git 工具函数
// ============================================================================

/** 创建 Git 快照 */
async function gitSnapshot(projectRoot: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["add", "-A"], { cwd: projectRoot, shell: true });
    child.on("close", () => {
      const commit = spawn("git", ["commit", "-m", message], { cwd: projectRoot, shell: true });
      let out = "";
      commit.stdout.on("data", (d) => (out += d.toString()));
      commit.stderr.on("data", (d) => (out += d.toString()));
      commit.on("close", (code) => {
        if (code !== 0) {
          // 无变更时 commit 会失败，这是正常的
          resolve("no-changes-to-commit");
          return;
        }
        // 获取最新 commit hash
        const log = spawn("git", ["log", "-1", "--format=%H"], { cwd: projectRoot, shell: true });
        let hash = "";
        log.stdout.on("data", (d) => (hash += d.toString().trim()));
        log.on("close", () => resolve(hash || "committed"));
      });
    });
  });
}

/** 获取 Git 历史 */
async function gitLog(projectRoot: string, count: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["log", `-${count}`, "--format=%h %s (%cr)"],
      { cwd: projectRoot, shell: true }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => resolve(out || "无 Git 历史"));
  });
}

/** Git 回滚 */
async function gitRevert(projectRoot: string, commitHash: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["reset", "--hard", commitHash],
      { cwd: projectRoot, shell: true }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(`✅ 已回滚到 ${commitHash}`);
      } else {
        reject(new Error(out || "回滚失败"));
      }
    });
  });
}

// ============================================================================
// 导出
// ============================================================================

export const selfOptTools: Record<string, ToolDefinition> = {
  self_inspect: selfInspectTool,
  external_research: externalResearchTool,
  generate_proposal: generateProposalTool,
  implement_change: implementChangeTool,
  run_tests: runTestsTool,
  git_snapshot: gitSnapshotTool,
};
