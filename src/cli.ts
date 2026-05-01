/**
 * @file cli.ts — CLI 交互入口
 * @description
 *   Mini Agent v4.4 的用户界面层，负责初始化所有子系统并启动交互循环。
 *
 *   职责：
 *   1. 加载 .env 环境变量
 *   2. 初始化核心子系统（ToolRegistry、ToolMonitor、SkillRegistry、OutputManager）
 *   3. 自动发现并加载 skills/ 目录下的技能包
 *   4. 注册所有工具（内置 + 技能贡献 + self-opt）
 *   5. 显示欢迎信息和工作空间概览
 *   6. 启动 readline 循环，处理用户输入
 *   7. 处理内置命令（.stats、.skills、.profile、.skill、.plan、.log、.optimize、quit）
 *   8. 打印最终统计报告
 *
 *   启动流程：
 *   ```
 *   dotenv 加载 .env
 *   → 创建 ToolRegistry + ToolMonitor + SkillRegistry + OutputManager
 *   → 注册内置工具（filesystem、exec、web、skills、self-opt）
 *   → 发现并加载 skills/ 目录下的技能包
 *   → 合并技能贡献的工具/工具箱到主注册表
 *   → 显示欢迎信息（模型、工具箱、工具列表、技能列表）
 *   → readline 循环：
 *     → 用户输入
 *     → 内置命令 → 执行并显示结果
 *     → 其他 → runAgent() 两阶段执行
 *     → 显示回复（通过 OutputManager 安全输出）
 *     → 重复...
 *   → quit → 打印最终报告 → 退出
 *   ```
 *
 *   内置命令（v4.4 更新）：
 *   - `.stats` — 查看工具使用统计
 *   - `.skills` — 查看已加载技能
 *   - `.profile <name>` — 切换模型预设
 *   - `.skill search <query>` — 搜索 ClawHub 技能
 *   - `.skill install <slug>` — 安装技能
 *   - `.skill list` — 列出已安装技能
 *   - `.plan <内容>` — 跳过规划直接执行
 *   - `.log <路径>` — 开启增量日志
 *   - `.optimize` — 自我优化（inspect/research/propose/auto）
 *   - `quit` / `exit` — 退出程序
 *
 * @module cli
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "readline";
import { runAgent, MODEL } from "./core/agent.js";
import { DefaultToolRegistry } from "./core/registry.js";
import { DefaultToolMonitor } from "./core/monitor.js";
import { DefaultSkillRegistry } from "./core/skill-registry.js";
import { discoverSkillPackages, parseSkillMd } from "./core/skill-loader.js";
import { createClawHubClient, searchLocalSkills } from "./core/clawhub-client.js";
import { OutputManager } from "./core/output-manager.js";
import { getDefaultWorkspace } from "./security/sandbox.js";
import { DEFAULT_TOOLBOXES } from "./toolboxes.js";
import { MODEL_PROFILES, applyModelProfile } from "./core/config.js";
import { filesystemTools } from "./tools/filesystem.js";
import { execTools } from "./tools/exec.js";
import { webTools } from "./tools/web.js";
import { skillsTools } from "./tools/skills.js";
import { selfOptTools } from "./tools/self-opt.js";
import { inspectSelf } from "./core/self-opt/inspector.js";
import { researchExternal } from "./core/self-opt/researcher.js";
import { generateProposals, formatProposals } from "./core/self-opt/proposal-engine.js";
import { runProposalTests, formatTestResults, executeOptimization } from "./core/self-opt/self-test-runner.js";
import { autoOptimize, formatAutoOptimizeResult } from "./core/self-opt/auto-optimizer.js";
import { startFeishuPollServer } from "./feishu/poll-server.js";
import type { FeishuConfig } from "./feishu/types.js";

/** ESM 下手动获取 __dirname */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 初始化核心子系统 ──

/** 工具注册表：管理所有工具的生命周期 */
const registry = new DefaultToolRegistry();

/** 性能监控器：自动记录工具调用的耗时和成功率 */
const monitor = new DefaultToolMonitor();

/** 技能注册表：管理技能包的加载与贡献合并 */
const skillRegistry = new DefaultSkillRegistry();

// ── ClawHub 客户端（技能市场） ──
const clawhub = createClawHubClient();

// 注册所有工具
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(skillsTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(selfOptTools)) registry.register(name, tool);

// ── 模型预设管理 ──
let activeProfile = process.env.MODEL_PROFILE ?? "balanced";

// ── 自动发现并加载技能包 ──
async function loadSkills() {
  const skillsRoot = process.env.MINI_AGENT_SKILLS
    ? process.env.MINI_AGENT_SKILLS
    : path.resolve(__dirname, "..", "skills");

  if (!fs.existsSync(skillsRoot)) {
    console.log(`ℹ️ 技能目录不存在: ${skillsRoot}`);
    return [];
  }

  const packages = await discoverSkillPackages(skillsRoot);
  for (const pkg of packages) {
    skillRegistry.registerPackage(pkg);
    console.log(`📦 已加载技能包: ${pkg.name} (${pkg.skills.length} 个技能)`);
    const contributedTools = pkg.skills.flatMap((s) => s.tools ? Object.entries(s.tools) : []);
    for (const [name, tool] of contributedTools) {
      try { registry.register(name, tool); } catch { console.log(`⚠️ 工具 "${name}" 已存在，跳过`); }
    }
  }
  return packages;
}

// ============================================================================
// CLI 主循环
// ============================================================================

/**
 * CLI 主函数
 *
 * 交互模式，等待用户输入并显示 Agent 回复。
 * 两阶段模式：先规划（Phase 1）后执行（Phase 2）。
 */
async function main() {
  // ── 加载技能包 ──
  await loadSkills();

  // ── 合并技能贡献的工具箱 ──
  const skillToolboxes = skillRegistry.getAllToolboxes();
  const allToolboxes = [...DEFAULT_TOOLBOXES, ...skillToolboxes];

  // ── 构建系统提示 ──
  const skillPrompts = skillRegistry.getSystemPrompts();

  // ── 显示欢迎信息 ──
  console.log("🤖 Mini Agent v4.5 已启动");
  console.log(`📡 模型: ${MODEL} | 预设: ${activeProfile}`);
  console.log(`📂 工作空间: ${getDefaultWorkspace()}`);
  console.log(`🧰 工具箱: ${allToolboxes.map(t => t.name).join(", ")}`);
  console.log(`🔧 工具: ${registry.list().join(", ")}`);
  const loadedSkills = skillRegistry.getAll();
  if (loadedSkills.length > 0) {
    console.log(`🎯 技能: ${loadedSkills.map(s => s.name).join(", ")}`);
  }
  console.log(
    '💡 输入问题，或 "quit" 退出 | 命令: .stats .skills .profile .skill .plan .log .optimize',
  );
  console.log("─".repeat(60));

  // ── 自动启动飞书长轮询（如果配置了飞书凭证） ──
  const feishuAppId = process.env.FEISHU_APP_ID;
  const feishuAppSecret = process.env.FEISHU_APP_SECRET;
  if (feishuAppId && feishuAppSecret) {
    console.log("\n📱 检测到飞书配置，正在启动 WebSocket 长轮询...");
    try {
      const feishuConfig: FeishuConfig = {
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        port: 0,
      };

      async function handleFeishuMessage(
        content: string,
        _chatId: string,
        _senderId: string
      ): Promise<string> {
        try {
          console.log(`[飞书] 处理: ${content.slice(0, 50)}...`);
          return await runAgent(content, {
            registry,
            monitor,
            toolboxes: allToolboxes,
            agentConfig: { debug: true },
            systemPrompt: skillPrompts.length > 0 ? skillPrompts.join("\n\n") : undefined,
          });
        } catch (err: any) {
          console.error(`[飞书] 处理失败:`, err);
          return "抱歉，处理您的消息时出现了错误。";
        }
      }

      // 后台启动飞书，不阻塞 readline
      startFeishuPollServer(feishuConfig, handleFeishuMessage).catch((err) => {
        console.error("❌ 飞书长轮询启动失败:", err);
      });
    } catch (err: any) {
      console.error("❌ 飞书初始化失败:", err);
    }
  }

  // ── 状态变量 ──
  let logFile: string | null = null;

  // ── 创建 readline 接口 ──
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const outputManager = new OutputManager(rl, "\n> ");

  // ── 异步问答处理 ──
  // readline.question() 是回调式的，用 Promise 包装为 async/await
  let resolveAsk: ((v: string | null) => void) | null = null;
  rl.on("close", () => { resolveAsk?.(null); });

  /** 向用户提问并等待回答 */
  const ask = (q: string) => new Promise<string | null>((resolve) => {
    resolveAsk = resolve;
    try { rl.question(q, (answer) => resolve(answer)); } catch { resolve(null); }
  });

  // ── 主循环 ──
  while (true) {
    const input = await ask("\n> ");
    if (input === null || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    // 内置命令：显示统计
    if (input === ".stats") {
      outputManager.write("\n" + monitor.report());
      continue;
    }

    // 内置命令：显示已加载技能
    if (input === ".skills") {
      const skills = skillRegistry.getAll();
      if (skills.length === 0) {
        outputManager.write("\n🎯 暂无已加载的技能");
      } else {
        const lines = ["\n🎯 已加载技能"];
        for (const s of skills) lines.push(`  - ${s.name} (${s.id}): ${s.description}`);
        outputManager.write(lines.join("\n"));
      }
      continue;
    }

    // 内置命令：切换模型预设
    if (input.startsWith(".profile")) {
      const parts = input.split(/\s+/);
      if (parts.length < 2) {
        const lines = [`\n📡 当前模型预设: ${activeProfile}`, "\n可用预设:"];
        for (const [name, profile] of Object.entries(MODEL_PROFILES)) {
          const marker = name === activeProfile ? " ← 当前" : "";
          lines.push(`  - ${name}: ${profile.description}${marker}`);
        }
        outputManager.write(lines.join("\n"));
      } else {
        const profileName = parts[1];
        if (profileName in MODEL_PROFILES) {
          activeProfile = profileName;
          outputManager.write(`📡 模型预设已切换到: ${profileName}`);
          outputManager.write("💡 提示：新建 session 后生效");
        } else {
          outputManager.write(`❌ 未知预设: ${profileName}。使用 .profile 查看可用列表。`);
        }
      }
      continue;
    }

    // 内置命令：技能市场操作
    if (input.startsWith(".skill ")) {
      const parts = input.split(/\s+/);
      const subCmd = parts[1];

      if (subCmd === "search" && parts.length >= 3) {
        const query = parts.slice(2).join(" ");
        outputManager.write(`🔍 搜索技能: "${query}"...`);
        try {
          const skillsRoot = path.resolve(__dirname, "..", "skills");
          const localResults = searchLocalSkills(skillsRoot, query);
          let clawhubResults: any[] = [];
          try { clawhubResults = await clawhub.search(query, 10); } catch { /* ignore */ }
          const lines = ["\n📦 搜索结果:"];
          if (localResults.length > 0) {
            lines.push("\n本地技能:");
            for (const s of localResults) lines.push(`  - ${s.name} (${s.slug}): ${s.description}`);
          }
          if (clawhubResults.length > 0) {
            lines.push("\nClawHub:");
            for (const s of clawhubResults) lines.push(`  - ${s.name} (${s.slug}) ⭐${s.stars} 📥${s.downloads}: ${s.description}`);
          }
          if (localResults.length === 0 && clawhubResults.length === 0) lines.push("  未找到匹配的技能");
          outputManager.write(lines.join("\n"));
        } catch (err: any) { outputManager.write(`❌ 搜索失败: ${err?.message ?? err}`); }
        continue;
      }

      if (subCmd === "install" && parts.length >= 3) {
        const slug = parts[2];
        outputManager.write(`📥 安装技能: ${slug}...`);
        try {
          const result = await clawhub.download(slug);
          outputManager.write(`✅ 已安装到: ${result.path}`);
          outputManager.write("💡 重启后生效");
        } catch (err: any) { outputManager.write(`❌ 安装失败: ${err?.message ?? err}`); }
        continue;
      }

      if (subCmd === "list") {
        const skillsRoot = path.resolve(__dirname, "..", "skills");
        const localResults = searchLocalSkills(skillsRoot, "");
        const lines = ["\n📦 已安装技能:"];
        for (const s of localResults) lines.push(`  - ${s.name} (${s.slug}): ${s.description}`);
        if (localResults.length === 0) lines.push("  暂无已安装的技能");
        outputManager.write(lines.join("\n"));
        continue;
      }

      outputManager.write("❌ 未知 .skill 命令。用法: .skill search <query> | .skill install <slug> | .skill list");
      continue;
    }

    // 内置命令：设置日志文件
    if (input.startsWith(".log ")) {
      logFile = input.slice(5).trim() || null;
      outputManager.write(logFile ? `📝 增量日志已开启: ${logFile}` : "📝 增量日志已关闭");
      continue;
    }

    // 内置命令：自我优化
    if (input === ".optimize" || input.startsWith(".optimize ")) {
      const subCmd = input.split(/\s+/)[1] || "";
      const projectRoot = path.resolve(__dirname, "..");
      const srcDir = path.resolve(projectRoot, "src");
      try {
        outputManager.beginOutput();
        if (subCmd === "inspect") {
          outputManager.write("\n🔍 启动自我审视...");
          const report = await inspectSelf(srcDir);
          const lines = ["", "═══════════════════════════════════════════════════", "🔍 Self-Inspection Report", "═══════════════════════════════════════════════════",
            `📅 时间: ${report.timestamp}`, `📦 版本: v${report.version}`, "", "📊 代码质量指标:"];
          for (const m of report.qualityMetrics) {
            const icon = m.passed ? "✅" : "⚠️";
            lines.push(`  ${icon} ${m.name}: ${m.value}${m.target ? ` (目标: ${m.target})` : ""}`);
            if (m.note) lines.push(`     → ${m.note}`);
          }
          lines.push("", "🏗️ 架构完整性检查:");
          const failed = report.architectureChecks.filter((c) => !c.passed);
          lines.push(`  ✅ 通过: ${report.architectureChecks.length - failed.length}/${report.architectureChecks.length}`);
          if (failed.length > 0) {
            lines.push("  ❌ 未通过:");
            for (const c of failed) lines.push(`    - ${c.name}: ${c.recommendation || c.details}`);
          }
          lines.push("", "⚡ 痛点:");
          if (report.painPoints.length === 0) lines.push("  暂无发现");
          else for (const p of report.painPoints) {
            const sev = p.severity === "high" ? "🔴" : p.severity === "medium" ? "🟡" : "🟢";
            lines.push(`  ${sev} ${p.description}`);
          }
          lines.push("", "💡 优化建议:");
          for (const s of report.suggestions) lines.push(`  → ${s}`);
          lines.push(`\n📝 总评: ${report.summary}`);
          outputManager.write(lines.join("\n"));
        } else if (subCmd === "research") {
          outputManager.write("\n🌐 启动外部调研...");
          const report = await researchExternal();
          const lines = ["", "═══════════════════════════════════════════════════", "🌐 External Research Report", "═══════════════════════════════════════════════════",
            `📦 找到资源: ${report.references.length} 个`, "", "🔬 提取的架构模式:"];
          for (const p of report.extractedPatterns) { lines.push(`  ▸ ${p.name} (${p.sourceReferences.length} 来源)`); lines.push(`    ${p.description}`); }
          lines.push("", "📄 参考资源:");
          for (const ref of report.references.slice(0, 10)) { const icon = ref.type === "paper" ? "📑" : "💻"; lines.push(`  ${icon} [${ref.type}] ${ref.title} ⭐${ref.relevance}/10`); lines.push(`     ${ref.url}`); }
          lines.push(`\n📝 ${report.summary}`);
          outputManager.write(lines.join("\n"));
        } else if (subCmd === "auto") {
          outputManager.write("\n🚀 全自动优化...");
          const projectRoot = path.resolve(__dirname, "..");
          const result = await autoOptimize(srcDir, projectRoot);
          outputManager.write(formatAutoOptimizeResult(result));
        } else if (subCmd === "propose") {
          outputManager.write("\n📋 生成优化提案...");
          const inspectReport = await inspectSelf(srcDir);
          const researchReport = await researchExternal();
          const proposals = generateProposals(inspectReport, researchReport);
          outputManager.write(formatProposals(proposals));
        } else if (subCmd === "propose") {
          outputManager.write("\n📋 生成优化提案...");
          const inspectReport = await inspectSelf(srcDir);
          const researchReport = await researchExternal();
          const proposals = generateProposals(inspectReport, researchReport);
          outputManager.write(formatProposals(proposals));
        } else {
          outputManager.write("\n🚀 启动自我优化流程...");
          outputManager.write("\n[1/2] 🔍 自我审视中...");
          const inspectReport = await inspectSelf(srcDir);
          outputManager.write(`  ✅ 架构完整度: ${inspectReport.architectureChecks.filter((c) => c.passed).length}/${inspectReport.architectureChecks.length}`);
          outputManager.write(`  ⚡ 发现 ${inspectReport.painPoints.length} 个痛点`);
          outputManager.write("\n[2/2] 🌐 外部调研中...");
          const researchReport = await researchExternal();
          outputManager.write(`  ✅ 找到 ${researchReport.references.length} 个资源`);
          outputManager.write(`  🔬 提取 ${researchReport.extractedPatterns.length} 个架构模式`);
          outputManager.writeLines(["", "═══════════════════════════════════════════════════", "📋 自我优化完成", "═══════════════════════════════════════════════════"]);
          outputManager.write(`📝 架构: ${inspectReport.summary}`);
          outputManager.write(`🌐 调研: ${researchReport.summary}`);
          outputManager.writeLines(["", "💡 子命令:", "  .optimize inspect   — 完整审视报告", "  .optimize research  — 完整调研报告", "  .optimize propose   — 生成优化提案", "  .optimize auto      — 全自动优化"]);
        }
      } catch (err: any) { outputManager.write(`\n❌ 自我优化失败: ${err?.message ?? err}`); }
      finally { outputManager.endOutput(); }
      continue;
    }

    // 内置命令：跳过规划
    const skipPlanning = input.startsWith(".plan ");
    const actualInput = skipPlanning ? input.slice(6) : input;

    try {
      outputManager.beginOutput();
      const reply = await runAgent(actualInput, {
        registry,
        monitor,
        toolboxes: allToolboxes,
        skipPlanning,
        agentConfig: { debug: true, logFile, outputManager },
        systemPrompt: skillPrompts.length > 0 ? skillPrompts.join("\n\n") : undefined,
        onToolCall: (name, args, result) => {
          const short = result.length > 100 ? result.slice(0, 100) + "..." : result;
          outputManager.write(`  🔧 ${name} → ${short}`);
        },
        onPlan: async (plan) => {
          outputManager.writeLines(["\n📋 执行计划:", `  摘要: ${plan.summary}`, `  工具箱: ${plan.requiredToolboxes.join(", ")}`, `  预估 token: ${plan.estimatedTokens.total}`, `  风险: ${plan.riskLevel}`]);
          if (plan.confirmationMessage) outputManager.write(`  ⚠️ ${plan.confirmationMessage}`);
          outputManager.endOutput();
          const confirm = await ask("\n✅ 确认执行? (y/n): ");
          outputManager.beginOutput();
          return confirm?.toLowerCase() === "y";
        },
      });
      outputManager.write(`\n🦾 ${reply}`);
    } catch (err: any) {
      outputManager.write(`\n❌ 错误: ${err?.message ?? err}`);
    } finally {
      outputManager.endOutput();
    }
  }

  // ── 清理和退出 ──
  rl.close();
  console.log("\n👋 bye");
  console.log("\n" + monitor.report());
}

main().catch(console.error);
