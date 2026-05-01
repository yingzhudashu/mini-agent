import fs from 'fs';
let c = fs.readFileSync('README.md', 'utf-8');
const idx = c.indexOf('## 内置命令');
if (idx !== -1) {
  const section = `## 自我优化系统（v4.2+）

Mini Agent 具备自我优化能力，可自主改进代码质量：

- \`.optimize inspect\` — 自我审视（代码质量 + 架构检查）
- \`.optimize research\` — 外部调研（arXiv + GitHub）
- \`.optimize propose\` — 生成优化提案（按风险排序）
- \`.optimize auto\` — 全自动优化（低风险自动执行）

核心组件：inspector.ts → researcher.ts → proposal-engine.ts → diff-generator.ts → self-test-runner.ts

安全规则：修复次数 ≤ 2 次 | 测试超时 ≤ 120 秒 | 危险命令拦截 | 低风险自动执行

`;
  c = c.substring(0, idx) + section + c.substring(idx);
  fs.writeFileSync('README.md', c, 'utf-8');
  console.log('README updated');
} else {
  console.log('section not found');
}
