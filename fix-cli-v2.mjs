import fs from 'fs';
let c = fs.readFileSync('src/cli.ts', 'utf-8');

// Find and remove duplicate handlers
// Pattern: after the first propose handler's else{...}, there's a duplicate
const search = `outputManager.write(formatProposals(proposals));
        } else {
          outputManager.write("\\n🚀 启动自我优化流程...");
          const lowRisk = proposals.filter((p) => p.riskLevel === "low");
          outputManager.write(\`  🟢 低风险: \${lowRisk.length} 个（自动执行）\`);`;

if (c.includes(search)) {
  const replacement = `outputManager.write(formatProposals(proposals));
        } else {
          outputManager.write("\\n🚀 启动自我优化流程...");
          outputManager.write("\\n[1/2] 🔍 自我审视中...");`;
  // Remove the entire duplicate section
  const dupStart = c.indexOf('const lowRisk = proposals.filter');
  const dupEnd = c.indexOf('} else if (subCmd === "propose") {', dupStart);
  if (dupStart > 0 && dupEnd > dupStart) {
    c = c.substring(0, dupStart - 10) + c.substring(dupEnd);
    // Also remove the second duplicate
    const dup2Start = c.indexOf('} else if (subCmd === "propose") {');
    const dup2End = c.indexOf('} else {', dup2Start + 10);
    const dup2End2 = c.indexOf('outputManager.write("\\n🚀 启动自我优化流程...");', dup2End);
    if (dup2Start > 0) {
      // Actually let's just find the right section
    }
  }
}

// Simple approach: find all occurrences and keep only the right structure
const autoIdx = c.indexOf('subCmd === "auto"');
const proposeIdx = c.indexOf('subCmd === "propose"');
const else1Idx = c.indexOf('} else {', autoIdx + 50);

console.log('auto:', autoIdx, 'propose:', proposeIdx, 'first else after auto:', else1Idx);

// Find the optimize block boundaries
const optStart = c.indexOf("if (subCmd === \"inspect\")");
if (optStart < 0) { console.log('No inspect found'); process.exit(1); }

// Find the closing of the entire optimize try-catch
const optTryEnd = c.indexOf("} finally { outputManager.endOutput(); }");
if (optTryEnd < 0) { console.log('No finally found'); process.exit(1); }

// Extract everything before and after the optimize handlers section
const beforeHandlers = c.substring(0, optStart);
const afterHandlers = c.substring(optTryEnd);

// Build clean handlers
const cleanHandlers = `if (subCmd === "inspect") {
          const report = await inspectSelf(srcDir);
          const lines = ["", "═".repeat(55), "🔍 自我审视报告", "═".repeat(55)];
          lines.push("", "📊 代码质量:");
          for (const m of report.qualityMetrics) { lines.push(\`  \${m.name}: \${m.value} \${m.unit ?? ""}\`); }
          lines.push("", "📁 模块分析:");
          for (const m of report.moduleAnalysis) { lines.push(\`  \${m.path}: \${m.linesOfCode} LOC, 测试: \${m.hasTests ? "有" : "无"}\`); }
          lines.push("", "🏗️ 架构完整性:");
          for (const c2 of report.architectureChecks) { lines.push(\`  \${c2.passed ? "✅" : "❌"} \${c2.name}: \${c2.note || c2.details}\`); }
          if (report.painPoints.length > 0) { lines.push("", "⚡ 痛点:"); for (const p of report.painPoints) lines.push(\`  - \${p.description}\`); }
          lines.push(\`\\n📝 \${report.summary}\`);
          outputManager.write(lines.join("\\n"));
        } else if (subCmd === "research") {
          const report = await researchExternal();
          const lines = ["", "═".repeat(55), "🌐 外部调研报告", "═".repeat(55)];
          lines.push("", "🔬 架构模式:");
          for (const p of report.extractedPatterns) { lines.push(\`  ▸ \${p.name} (\${p.sourceReferences.length} 来源)\`); lines.push(\`    \${p.description}\`); }
          lines.push("", "📄 参考资源:");
          for (const ref of report.references.slice(0, 10)) { const icon = ref.type === "paper" ? "📑" : "💻"; lines.push(\`  \${icon} [\${ref.type}] \${ref.title} ⭐\${ref.relevance}/10\`); lines.push(\`     \${ref.url}\`); }
          lines.push(\`\\n📝 \${report.summary}\`);
          outputManager.write(lines.join("\\n"));
        } else if (subCmd === "auto") {
          outputManager.write("\\n🚀 全自动优化...");
          const projectRoot = path.resolve(__dirname, "..");
          const result = await autoOptimize(srcDir, projectRoot);
          outputManager.write(formatAutoOptimizeResult(result));
        } else if (subCmd === "propose") {
          outputManager.write("\\n📋 生成优化提案...");
          const inspectReport = await inspectSelf(srcDir);
          const researchReport = await researchExternal();
          const proposals = generateProposals(inspectReport, researchReport);
          outputManager.write(formatProposals(proposals));
        } else {
          outputManager.write("\\n🚀 启动自我优化流程...");
          outputManager.write("\\n[1/2] 🔍 自我审视中...");
          const inspectReport = await inspectSelf(srcDir);
          outputManager.write(\`  ✅ 架构完整度: \${inspectReport.architectureChecks.filter((c) => c.passed).length}/\${inspectReport.architectureChecks.length}\`);
          outputManager.write(\`  ⚡ 发现 \${inspectReport.painPoints.length} 个痛点\`);
          outputManager.write("\\n[2/2] 🌐 外部调研中...");
          const researchReport = await researchExternal();
          outputManager.write(\`  ✅ 找到 \${researchReport.references.length} 个资源\`);
          outputManager.write(\`  🔬 提取 \${researchReport.extractedPatterns.length} 个架构模式\`);
          outputManager.writeLines(["", "═".repeat(55), "📋 自我优化完成", "═".repeat(55)]);
          outputManager.write(\`📝 架构: \${inspectReport.summary}\`);
          outputManager.write(\`🌐 调研: \${researchReport.summary}\`);
          outputManager.writeLines(["", "💡 子命令:", "  .optimize inspect   — 完整审视报告", "  .optimize research  — 完整调研报告", "  .optimize propose   — 生成优化提案", "  .optimize auto      — 全自动优化"]);
        }`;

c = beforeHandlers + cleanHandlers + afterHandlers;
fs.writeFileSync('src/cli.ts', c, 'utf-8');
console.log('Cleaned and rebuilt handlers');
