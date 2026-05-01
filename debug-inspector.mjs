import { inspectSelf } from './dist/src/core/self-opt/inspector.js';
import * as path from 'path';

// Simulate what CLI does with __dirname
const __dirname_sim = 'D:\\AIhub\\mini-agent\\src';
const projectRoot = path.resolve(__dirname_sim, "..");
const srcDir = path.resolve(projectRoot, "src");

console.log('__dirname_sim:', __dirname_sim);
console.log('projectRoot:', projectRoot);
console.log('srcDir:', srcDir);
console.log('');

const insp = await inspectSelf(srcDir);
console.log('Modules:', insp.moduleAnalysis.length);
console.log('Untested (>50 LOC):', insp.moduleAnalysis.filter(m => !m.hasTests && m.linesOfCode > 50).length);
console.log('');
console.log('=== Untested modules ===');
for (const m of insp.moduleAnalysis.filter(m => !m.hasTests)) {
  console.log(`  ${m.path}: ${m.linesOfCode} LOC, hasTests=${m.hasTests}`);
}
console.log('');
console.log('=== Modules with tests ===');
for (const m of insp.moduleAnalysis.filter(m => m.hasTests)) {
  console.log(`  ${m.path}: hasTests=true`);
}
