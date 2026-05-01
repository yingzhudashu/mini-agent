import fs from 'fs';
import path from 'path';

const srcDir = 'D:\\AIhub\\mini-agent\\src';
const testDir = path.join(srcDir, '..', 'tests');

const CORE_MODULES = [
  "core/agent.ts", "core/planner.ts", "core/registry.ts", "core/monitor.ts",
  "core/config.ts", "core/types.ts", "core/output-manager.ts", "core/loop-detector.ts",
  "core/skill-registry.ts", "core/skill-loader.ts", "core/clawhub-client.ts",
  "toolboxes.ts", "cli.ts", "index.ts",
];

function hasCorrespondingTest(srcPath, testDir) {
  const baseName = path.basename(srcPath, ".ts");
  const testFile = path.join(testDir, baseName + ".test.ts");
  if (fs.existsSync(testFile)) { console.log('  Found test file:', testFile); return true; }
  try {
    const testContent = fs.readFileSync(path.join(testDir, "test.ts"), "utf-8");
    if (testContent.includes(baseName) || testContent.includes(srcPath)) { console.log('  Matched in test.ts:', baseName); return true; }
  } catch {}
  return false;
}

console.log('Checking CORE_MODULES:');
let untestedCount = 0;
for (const mod of CORE_MODULES) {
  const fullPath = path.join(srcDir, mod);
  if (!fs.existsSync(fullPath)) { console.log('  MISSING:', mod); continue; }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const loc = content.split('\n').length;
  const hasTest = hasCorrespondingTest(mod, testDir);
  const qualifies = !hasTest && loc > 50;
  if (!hasTest) untestedCount++;
  console.log(`  ${mod}: ${loc} lines, hasTest=${hasTest}, qualifies=${qualifies}`);
}
console.log('\nUntested modules > 50 lines:', untestedCount);
