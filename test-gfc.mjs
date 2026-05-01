// Quick test of generateFileChanges logic
import fs from 'fs';

// Simulate inspection result
const mockInspection = {
  moduleAnalysis: [
    { path: "core/planner.ts", hasTests: false, linesOfCode: 212 },
    { path: "core/types.ts", hasTests: false, linesOfCode: 554 },
    { path: "core/output-manager.ts", hasTests: false, linesOfCode: 164 },
    { path: "core/loop-detector.ts", hasTests: false, linesOfCode: 238 },
  ]
};

const mockProposal = {
  target: "添加缺失的测试文件",
  files: []
};

// Replicate generateFileChanges logic
if (mockProposal.target.includes("测试")) {
  const untested = mockInspection.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50);
  console.log('Untested modules found:', untested.length);
  for (const mod of untested.slice(0, 2)) {
    const fn = mod.path.split(/[\\/]/).pop()?.replace(/\.ts$/, "") || "module";
    console.log('  Would create: tests/' + fn + '.test.ts');
  }
} else {
  console.log('Title does not match');
}
