import fs from 'fs';
const c = fs.readFileSync('src/cli.ts', 'utf-8');

// Find all occurrences of key patterns
const patterns = [
  'if (subCmd === "inspect")',
  'subCmd === "auto"',
  'subCmd === "propose"',
  'subCmd === "research"',
  'finally { outputManager',
  'selfOptTools',
  '.optimize',
];

for (const p of patterns) {
  let idx = 0, count = 0;
  while ((idx = c.indexOf(p, idx)) >= 0) {
    count++;
    idx++;
  }
  console.log(`${p}: ${count} occurrences`);
}

// Find the optimize try block start and end
const tryStart = c.indexOf("try {");
const tryIdx = c.indexOf("selfOptTools");
const section = c.substring(Math.max(0, tryIdx - 500), tryIdx + 500);
console.log('\n--- Around selfOptTools ---');
console.log(section.substring(0, 300));
