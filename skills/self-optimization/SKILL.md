---
name: self-optimization
description: |
  Agent 自我优化能力：审视自身架构、调研先进方案、生成优化提案、实施变更并验证。
  通过 `.optimize` 指令触发。
  USE WHEN: 用户要求优化 Agent 自身、分析架构、调研新方案
  DON'T USE WHEN: 只是查询信息或执行普通任务
---

# Self-Optimization Skill

Agent 的自我优化能力，支持：
- **自我审视**：分析代码质量、架构完整性、痛点
- **外部调研**：搜索 arXiv 论文和 GitHub 项目
- **提案生成**：基于分析结果生成优化方案（含测试用例）
- **实施变更**：低风险自动执行，高风险需确认
- **测试验证**：自动运行测试，失败自动修复
- **Git 快照**：每次变更前保存快照，支持回滚

## 使用方式

- `.optimize` — 执行完整自我审视 + 外部调研
- `.optimize inspect` — 仅自我审视
- `.optimize research` — 仅外部调研
- `.optimize --dry-run` — 仅生成提案，不执行

## 工具列表

| 工具 | 权限 | 说明 |
|------|------|------|
| `self_inspect` | sandbox | 分析当前架构和代码质量 |
| `external_research` | sandbox | 搜索外部先进架构和论文 |
| `generate_proposal` | sandbox | 生成优化提案（含测试用例） |
| `implement_change` | require-confirm | 实施代码变更 |
| `run_tests` | allowlist | 运行测试验证 |
| `git_snapshot` | require-confirm | Git 快照管理 |

## 安全规则

1. 低风险（添加文件/工具）→ 自动执行
2. 中风险（修改现有逻辑）→ 用户确认
3. 高风险（修改核心模块）→ 必须确认 + Git 快照
4. 破坏性（删除文件）→ 必须手动审核
