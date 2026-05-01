import fs from 'fs';
// Read auto-optimizer.ts and check if generateFileChanges is called
const c = fs.readFileSync('src/core/self-opt/auto-optimizer.ts', 'utf-8');
console.log('Has generateFileChanges call:', c.includes('generateFileChanges('));
console.log('Has generateFileChanges import:', c.includes('generateFileChanges'));
// Show relevant section
const idx = c.indexOf('generateFileChanges');
if (idx >= 0) console.log(c.substring(Math.max(0, idx - 50), idx + 200));
