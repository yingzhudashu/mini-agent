# Mini Agent 架构文档

> **版本**: v4.8  
> **最后更新**: 2026-05-03  
> **描述**: Mini Agent v4 的整体架构设计、模块划分和数据流

---

## 系统概览

Mini Agent 是一个基于 TypeScript 的最小化 LLM Agent，采用 **两阶段架构（Plan-then-Execute）** 和 **技能系统（Skill System）**。

```
┌─────────────────────────────────────────────────────────────┐
│                         用户输入                              │
│                          ↓                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Phase 1: Planning（规划阶段）                       │     │
│  │                                                     │     │
│  │  输入: 用户需求 + 工具箱描述（内置 + 技能贡献）        │    │
│  │  过程: LLM 分析需求，生成结构化执行计划                │    │
│  │  输出: StructuredPlan（步骤、工具箱、配置、预估）      │    │
│  └──────────────────────┬──────────────────────────────┘     │
│                         ↓                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Phase 2: Execution（执行阶段）                      │     │
│  │                                                     │     │
│  │  输入: StructuredPlan + 用户需求                     │    │
│  │  过程: ReAct 循环（思考 → 工具调用 → 执行 → 反馈）    │    │
│  │  输出: 最终回复                                     │    │
│  │                                                     │     │
│  │  v4.1 新增机制:                                     │    │
│  │  - 循环检测（LoopDetector）：防止无限循环            │    │
│  │  - 上下文压缩：消息过长时自动摘要历史                 │    │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
src/
├── types/              # 类型定义（按领域拆分）
│   ├── index.ts        # barrel export
│   ├── tool.ts         # 工具/工具箱/注册表类型
│   ├── config.ts       # 双层配置体系
│   ├── loop.ts         # 循环检测
│   ├── memory.ts       # 跨会话记忆
│   ├── context.ts      # 上下文管理
│   ├── planning.ts     # 规划系统
│   ├── pipeline.ts     # 线性管线
│   ├── stats.ts        # 性能监控
│   ├── skill.ts        # 技能系统
│   ├── clawhub.ts      # 技能市场
│   ├── session.ts      # 会话管理
│   └── agent.ts        # Agent 运行结果
├── core/               # 核心引擎
│   ├── agent.ts        # 薄编排层：plan → execute
│   ├── executor.ts     # ReAct 循环执行器（v4.8 拆分）
│   ├── planner.ts      # Phase 1: LLM 规划
│   ├── registry.ts     # 工具注册表
│   ├── monitor.ts      # 性能监控
│   ├── config.ts       # 双层配置 + 预设
│   ├── logger.ts       # 增量日志
│   ├── loop-detector.ts
│   ├── context-manager.ts
│   ├── memory-store.ts
│   ├── keyword-index.ts
│   ├── session-manager.ts  # → re-export from session/
│   ├── workspace-manager.ts # → re-export from session/
│   ├── skill-registry.ts
│   ├── skill-loader.ts
│   ├── clawhub-client.ts
│   ├── output-manager.ts
│   ├── instance-manager.ts
│   └── self-opt/       # 自我优化子系统
├── tools/              # 工具实现
│   ├── filesystem.ts
│   ├── exec.ts
│   ├── web.ts
│   ├── skills.ts
│   └── self-opt.ts
├── security/           # 安全
│   └── sandbox.ts
├── session/            # 会话管理（v4.7 新增）
│   ├── manager.ts      # SessionManager
│   ├── workspace.ts    # WorkspaceManager
│   └── index.ts        # barrel export
├── feishu/             # 飞书适配层
│   ├── types.ts
│   ├── server.ts
│   └── poll-server.ts
├── cli/                # CLI 入口（v4.8 移动）
│   └── cli.ts
├── feishu-cli.ts       # 飞书入口
├── toolboxes.ts        # 默认工具箱定义
└── index.ts            # barrel export
```

---

## 核心模块

### 1. Agent 引擎（`core/agent.ts` + `core/executor.ts`）

**职责**：两阶段架构的编排和执行。

- `runAgent()`: 主入口，协调 Phase 1 → Phase 2
- `executePlan()`: ReAct 循环执行器（v4.8 从 agent.ts 拆分）
- `runPipeline()`: 线性管线执行器（无 LLM 循环）

**配置合并优先级**（从低到高）：
1. `getDefaultAgentConfig()` → 默认值
2. `runAgent(options.agentConfig)` → 用户传入
3. `plan.suggestedConfig` → 规划器推荐

### 2. 规划器（`core/planner.ts`）

**职责**：Phase 1，生成结构化执行计划。

- 分析用户需求 + 可用工具箱
- LLM 生成 `StructuredPlan`
- 包含步骤、工具箱选择、配置推荐、Token 预估

### 3. 工具系统（`tools/` + `core/registry.ts`）

**职责**：工具的定义、注册和执行。

- `ToolDefinition`: 工具定义（schema + handler + permission）
- `DefaultToolRegistry`: 工具注册表实现
- `ToolContext`: 执行上下文（cwd、allowedPaths、permission）

### 4. 技能系统（`core/skill-registry.ts` + `core/skill-loader.ts`）

**职责**：技能的发现、加载和贡献合并。

- 自动发现 `skills/` 目录下的技能包
- 合并技能贡献的工具和工具箱
- 支持 ClawHub 技能市场

### 5. 会话管理（`session/`）

**职责**：多会话隔离和管理（v4.7 新增）。

- 每个会话拥有独立的：
  - 工具注册表（可从全局克隆并裁剪）
  - 工作空间路径（可选）
  - 配置覆盖
- 支持会话创建、切换、销毁
- 工具升维/降维（会话 ↔ 主空间）

### 6. 记忆系统（`core/memory-store.ts` + `core/keyword-index.ts`）

**三层记忆架构**（v4.6）：
- **Layer 1**: 上下文记忆（当前对话历史）
- **Layer 2**: 会话记忆（同聊天室的长期记忆，持久化到文件）
- **Layer 3**: 语义检索（跨所有会话的相关记忆，关键词索引）

### 7. 上下文管理（`core/context-manager.ts`）

**职责**：Token 估算与上下文压缩。

- 基于字符类型的启发式 Token 估算
- 上下文预算管理
- 智能压缩（保留 system + 首条用户消息 + 最近 2 轮对话）
- 记忆注入

### 8. 循环检测（`core/loop-detector.ts`）

**职责**：防止 Agent 陷入无限循环（v4.1 新增）。

- 检测相同工具 + 相同参数的重复调用
- 检测已知轮询模式但无状态变化
- 检测交替的 ping-pong 模式
- 渐进式：先警告、后拦截

---

## 数据流

```
用户输入
  ↓
CLI/飞书入口
  ↓
runAgent(userInput, options)
  ↓
┌─ Phase 1: Planning ──────────────────┐
│  generatePlan(userInput, toolboxes)   │
│  → StructuredPlan                     │
│  → 合并 plan.suggestedConfig          │
│  → 高风险操作需用户确认                │
└──────────────┬────────────────────────┘
               ↓
┌─ Phase 2: Execution ─────────────────┐
│  executePlan(plan, userInput, ...)    │
│  → 筛选工具（按 toolbox 策略）         │
│  → 初始化上下文管理器                  │
│  → 注入三层记忆                       │
│  → ReAct 循环:                        │
│     while (turns > 0):                │
│       LLM(messages, tools)            │
│       if no tool_calls: return reply  │
│       for each tool_call:             │
│         循环检测                       │
│         执行工具                       │
│         结果追加到上下文                │
│  → 保存会话记忆                       │
└──────────────┬────────────────────────┘
               ↓
          最终回复
```

---

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v4.8 | 2026-05-03 | 架构重构：类型拆分、executor 独立、目录分层 |
| v4.7 | 2026-05-02 | 多会话系统、工作空间隔离 |
| v4.6 | 2026-05-01 | 三层记忆、上下文管理、关键词索引 |
| v4.5 | 2026-04-30 | 飞书长轮询、WebSocket 支持 |
| v4.4 | 2026-04-29 | CLI 命令增强、OutputManager |
| v4.3 | 2026-04-28 | 技能系统、ClawHub 集成 |
| v4.2 | 2026-04-27 | 自我优化子系统 |
| v4.1 | 2026-04-26 | 循环检测、模型预设 |
| v4.0 | 2026-04-25 | 两阶段架构、技能系统 |
