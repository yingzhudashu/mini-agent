import fs from 'fs';
let c = fs.readFileSync('src/core/self-opt/proposal-engine.ts', 'utf-8');
if (!c.includes('export function generateFileChanges')) {
  // Add before formatProposals
  const marker = 'export function formatProposals';
  const newFunc = `export function generateFileChanges(proposal: OptimizationProposal, inspection: InspectionReport): void {
  if (proposal.files.length > 0) return;
  const changes: FileChange[] = [];
  if (proposal.target.includes("测试")) {
    const untested = inspection.moduleAnalysis.filter((m) => !m.hasTests && m.linesOfCode > 50);
    for (const mod of untested.slice(0, 2)) {
      const fn = mod.path.split(/[\\\\/]/).pop()?.replace(/\\.ts$/, "") || "module";
      const tp = "tests/" + fn + ".test.ts";
      const tc = '/**\\n * Auto-generated test for ' + fn + '\\n */\\n\\nimport assert from "assert";\\n\\ndescribe("' + fn + '", () => {\\n  it("should be importable", async () => {\\n    const m = await import("../../src/' + mod.path.replace(/\\\\/g, "/") + '");\\n    assert.ok(m);\\n  });\\n});\\n';
      changes.push({ path: tp, action: "create", content: tc });
    }
  }
  if (proposal.target.includes("any")) {
    const sc = '/**\\n * Find any types\\n */\\nimport * as fs from "fs";\\nimport * as path from "path";\\nfunction findAny(dir: string): string[] { const r: string[] = []; const fs2 = fs.readdirSync(dir); for (const f of fs2) { const fp = path.join(dir, f); const st = fs.statSync(fp); if (st.isDirectory() && !fp.includes("node_modules")) r.push(...findAny(fp)); else if (f.endsWith(".ts")) { const c = fs.readFileSync(fp, "utf-8"); const ls = c.split("\\\\n"); for (let i = 0; i < ls.length; i++) if (/:\\\\s*any\\\\b/.test(ls[i])) r.push(fp + ":" + (i+1)); } } return r; }\\nconst anyTypes = findAny(path.resolve(__dirname, "../src"));\\nif (anyTypes.length > 0) { console.log("Found any types:"); anyTypes.forEach(t => console.log("  " + t)); } else { console.log("No any types found!"); }\\n';
    changes.push({ path: "scripts/check-any-types.ts", action: "create", content: sc });
  }
  if (proposal.target.includes("catch")) {
    const sc = '/**\\n * Find empty catch blocks\\n */\\nimport * as fs from "fs";\\nimport * as path from "path";\\nfunction findCatch(dir: string): string[] { const r: string[] = []; const fs2 = fs.readdirSync(dir); for (const f of fs2) { const fp = path.join(dir, f); const st = fs.statSync(fp); if (st.isDirectory() && !fp.includes("node_modules")) r.push(...findCatch(fp)); else if (f.endsWith(".ts") && /catch\\\\s*\\\\([^)]*\\\\)\\\\s*\\\\{\\\\s*\\\\}/.test(fs.readFileSync(fp, "utf-8"))) r.push(fp); } return r; }\\nconst ec = findCatch(path.resolve(__dirname, "../src"));\\nif (ec.length > 0) { console.log("Empty catches:"); ec.forEach(f => console.log("  " + f)); } else { console.log("No empty catches!"); }\\n';
    changes.push({ path: "scripts/find-empty-catches.ts", action: "create", content: sc });
  }
  proposal.files = changes;
}

` + marker;
  c = c.replace(marker, newFunc);
  fs.writeFileSync('src/core/self-opt/proposal-engine.ts', c, 'utf-8');
  console.log('Added generateFileChanges');
} else { console.log('Already exists'); }
