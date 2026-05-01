import fs from 'fs';
let c = fs.readFileSync('src/core/self-opt/auto-optimizer.ts', 'utf-8');

// Add debug logging after inspection
c = c.replace(
  'console.log("\n[3/5] 📋 生成提案...");',
  'console.log("  [DEBUG] insp.moduleAnalysis count:", insp.moduleAnalysis.length);\n  console.log("  [DEBUG] untested:", insp.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50).length);\n  console.log("\n[3/5] 📋 生成提案...");'
);

// Add debug after generateFileChanges
c = c.replace(
  'for (const p of proposals) generateFileChanges(p, insp);',
  'for (const p of proposals) { generateFileChanges(p, insp); console.log("  [DEBUG] proposal:", p.target, "files:", p.files.length); }'
);

fs.writeFileSync('src/core/self-opt/auto-optimizer.ts', c, 'utf-8');
console.log('Added debug logging');
