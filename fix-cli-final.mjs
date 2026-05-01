import fs from 'fs';
let c = fs.readFileSync('src/cli.ts', 'utf-8');

// 1. Add import
if (!c.includes('auto-optimizer')) {
  const target = 'from "./core/self-opt/self-test-runner.js";';
  c = c.replace(target, target + '\nimport { autoOptimize, formatAutoOptimizeResult } from "./core/self-opt/auto-optimizer.js";');
  console.log('Added import');
}

// 2. Find and replace the old auto handler
const oldPattern = 'subCmd === "auto") {\n          outputManager.write("\\n🚀 全自动优化...");\n          outputManager.write("\\n[1/3] 🔍 自我审视..."';
const newPattern = 'subCmd === "auto") {\n          outputManager.write("\\n🚀 全自动优化...");\n          const projectRoot = path.resolve(__dirname, "..");\n          const result = await autoOptimize(srcDir, projectRoot);\n          outputManager.write(formatAutoOptimizeResult(result));\n        } else if (false';

if (c.includes('subCmd === "auto"')) {
  // Find start and end of auto block
  let start = c.indexOf('} else if (subCmd === "auto")');
  if (start >= 0) {
    // Find matching close brace
    let braceCount = 0;
    let end = -1;
    for (let i = start; i < c.length; i++) {
      if (c[i] === '{') braceCount++;
      if (c[i] === '}') { braceCount--; if (braceCount === 0 && i > start + 10) { end = i + 1; break; } }
    }
    if (end > start) {
      const replacement = `} else if (subCmd === "auto") {
          outputManager.write("\\n🚀 全自动优化...");
          const projectRoot = path.resolve(__dirname, "..");
          const result = await autoOptimize(srcDir, projectRoot);
          outputManager.write(formatAutoOptimizeResult(result));`;
      c = c.substring(0, start) + replacement + c.substring(end);
      console.log('Replaced auto handler');
    }
  }
}

// 3. Update version
c = c.replace(/v4\.[0-3]/g, 'v4.4');

fs.writeFileSync('src/cli.ts', c, 'utf-8');
console.log('Done');
