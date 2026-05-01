import fs from 'fs';
import path from 'path';

// Simulate what inspector finds
const srcDir = 'D:\\AIhub\\mini-agent\\src';

function analyzeDir(dir) {
  const results = [];
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...analyzeDir(fullPath));
      } else if (f.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const relPath = path.relative('D:\\AIhub\\mini-agent\\src', fullPath);
        results.push({ path: relPath, lines: content.split('\n').length, hasTest: false });
      }
    }
  } catch {}
  return results;
}

const modules = analyzeDir(srcDir);
console.log('Modules > 50 lines:');
for (const m of modules.filter(m => m.lines > 50)) {
  console.log(`  ${m.path}: ${m.lines} lines`);
}
