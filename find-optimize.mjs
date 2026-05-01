import fs from 'fs';
const c = fs.readFileSync('src/cli.ts', 'utf-8');

// Find the optimize block
const optimizeBlock = c.indexOf('if (subCmd === "inspect")');
console.log('inspect block at:', optimizeBlock);

// Show 500 chars around it
console.log('--- Context ---');
console.log(c.substring(Math.max(0, optimizeBlock - 200), optimizeBlock + 500));
