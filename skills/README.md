# Mini Agent 技能系统

Mini Agent v4 引入了技能系统（Skill System），允许以模块化的方式扩展 Agent 的能力。

## 概述

一个 **技能（Skill）** 是一个独立的能力单元，可以贡献：

1. **工具定义（tools）** — 注册到 ToolRegistry，供 LLM 调用
2. **工具箱（toolboxes）** — 用于 Phase 1 规划阶段的工具箱筛选
3. **系统提示词（systemPrompt）** — 追加到 Agent 的 system prompt
4. **SKILL.md** — 人类可读的技能说明文档

一个 **技能包（Skill Package）** 是一组相关技能的集合，存放在 `skills/<package-name>/` 目录下。

## 目录结构

```
skills/
├── default/                    # 默认技能包
│   ├── SKILL.md               # 技能包总览文档
│   ├── index.ts               # 技能包入口（导出 Skill[]）
│   └── files/
│       └── SKILL.md           # 单个技能文档
└── custom/                     # 自定义技能包（示例）
    ├── SKILL.md
    ├── index.ts
    └── my-tool/
        ├── SKILL.md
        └── tools.ts           # 工具定义
```

## 加载流程

1. CLI 启动时自动扫描 `skills/` 目录（可通过 `MINI_AGENT_SKILLS` 环境变量指定路径）
2. 每个一级子目录被视为一个 SkillPackage
3. 读取 `SKILL.md` 解析元数据（name、description、keywords）
4. 导入 `index.ts` 获取 `Skill[]` 导出
5. 扫描 `skills/` 子目录动态加载子技能
6. 将技能贡献合并到 ToolRegistry、Toolbox 列表和 System Prompt

## 如何创建自定义技能

### 步骤 1：创建技能包目录

```bash
mkdir -p skills/my-package
```

### 步骤 2：创建 SKILL.md

```markdown
---
name: 我的技能包
description: 描述这个技能包的功能
keywords: 关键词1,关键词2
---

# 我的技能包

详细说明...
```

### 步骤 3：创建 index.ts

```typescript
import type { Skill } from "../../core/types.js";

export const skills: Skill[] = [
  {
    id: "my-skill",
    name: "我的技能",
    description: "技能描述",
    keywords: ["关键词"],
    tools: myTools,       // 可选：贡献工具
    toolboxes: myBoxes,   // 可选：贡献工具箱
    systemPrompt: "...",  // 可选：系统提示词
  },
];
```

### 步骤 4：（可选）创建 tools.ts

如果技能需要贡献自定义工具，在同目录下创建 `tools.ts`：

```typescript
import type { ToolDefinition } from "../../core/types.js";

export const myTools: Record<string, ToolDefinition> = {
  my_tool: {
    schema: { /* OpenAI tool schema */ },
    handler: async (args, ctx) => ({ success: true, content: "结果" }),
    permission: "sandbox",
    help: "工具帮助说明",
    toolbox: "my-toolbox",
  },
};
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MINI_AGENT_SKILLS` | 技能目录路径 | `<项目根目录>/skills` |

## 内置命令

| 命令 | 说明 |
|------|------|
| `.skills` | 显示已加载的技能列表 |
