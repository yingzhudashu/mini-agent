# Mini Agent 架构文档

> 本文档描述 Mini Agent v4 的整体架构设计、模块划分和数据流。

## 系统概览

Mini Agent 是一个基于 TypeScript 的最小化 LLM Agent，采用 **两阶段架构（Plan-then-Execute）** 和 **技能系统（Skill System）**。

```
┌─────────────────────────────────────────────────────────────┐
│                         用户输入                              │
│                          ↓                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Phase 1: Planning（规划阶段）                       │     │
│  │                                                     │     │
│  │  输入: 用户需求 + 工具箱描述（内置 + 技能贡献）        │     │
│  │  输出: StructuredPlan                               │     │
│  │    - 步骤分解、工具箱选择、配置推荐、Token 预估        │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         ↓                                    │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Phase 2: Execution（执行阶段）                      │     │
│  │                                                     │     │
│  │  ReAct 循环: 思考 → 工具调用 → 执行 → 反馈 → 循环    │     │
│  │  工具筛选: 只发送 plan.requiredToolboxes 的工具       │     │
│  └──────────────────────┬─────────────────────────────┘     │
│                         ↓                                    │
│                      最终回复                                 │
└─────────────────────────────────────────────────────────────┘
```

## 模块架构

```
mini-agent/
├── src/
│   ├── cli.ts                    ← CLI 入口（用户界面层）
│   │   ├── 初始化所有子系统
│   │   ├── 发现并加载技能包
│   │   ├── 启动 readline 循环
│   │   └── 处理内置命令
│   │
│   ├── index.ts                  ← 统一导出（Barrel File）
│   │
│   ├── core/                     ← 核心子系统
│   │   ├── types.ts              ← 所有 TypeScript 类型定义
│   │   ├── agent.ts              ← Phase 2: ReAct 循环 + 主入口
│   │   ├── planner.ts            ← Phase 1: 规划器
│   │   ├── registry.ts           ← 工具注册表
│   │   ├── monitor.ts            ← 性能监控器
│   │   ├── config.ts             ← 双层配置系统
│   │   ├── logger.ts             ← 增量日志写入器
│   │   ├── output-manager.ts     ← CLI 输出管理器
│   │   ├── skill-registry.ts     ← 技能注册表
│   │   └── skill-loader.ts       ← 技能包自动发现与加载
│   │
│   ├── tools/                    ← 工具实现
│   │   ├── filesystem.ts         ← 8 个文件操作工具
│   │   ├── exec.ts               ← shell 命令执行工具
│   │   └── web.ts                ← 网页抓取 + 时间工具
│   │
│   ├── security/                 ← 安全模块
│   │   └── sandbox.ts            ← 路径沙箱
│   │
│   └── toolboxes.ts              ← 默认工具箱定义
│
├── skills/                       ← 技能包目录
│   ├── README.md                 ← 技能系统文档
│   └── default/                  ← 默认技能包
│       ├── SKILL.md
│       ├── index.ts
│       └── files/
│           └── SKILL.md
│
├── tests/
│   └── test.ts                   ← 集成测试
│
└── docs/
    └── ARCHITECTURE.md           ← 本文档
```

## 核心子系统详解

### 1. 两阶段架构（Plan-then-Execute）

#### Phase 1: Planning（规划阶段）

**文件**: `src/core/planner.ts`

**职责**: 分析用户需求，生成结构化执行计划（StructuredPlan）

**流程**:
1. 接收用户输入 + 可用工具箱列表
2. 构建 system prompt（规划专家角色 + JSON schema）
3. 调用 LLM（temperature=0.3，追求结构化输出稳定性）
4. 解析 JSON 响应 → 校验必要字段
5. 失败时最多重试 3 次，全部失败返回 fallback plan

**关键字段**:
- `steps[]`: 执行步骤列表
- `requiredToolboxes[]`: 需要的工具箱 ID
- `suggestedConfig`: 推荐的运行配置
- `estimatedTokens`: Token 消耗预估
- `riskLevel`: 风险等级（low/medium/high）
- `requiresConfirmation`: 是否需要用户确认

#### Phase 2: Execution（执行阶段）

**文件**: `src/core/agent.ts`

**职责**: 根据规划结果，运行 ReAct 循环执行任务

**流程**:
1. 根据 `plan.requiredToolboxes` 筛选工具
2. 初始化消息列表（system + user）
3. ReAct 循环:
   - LLM 回复 → 纯文本 = 完成 / tool_calls = 执行
   - 按序执行每个工具调用
   - 将结果追加到消息历史
4. 达到 maxTurns 或 LLM 不再调用工具时结束

**工具筛选策略**:
- `all`: 发送全部工具
- `toolbox`: 只发送相关工具箱的工具（默认）
- `auto`: 预留，未来可用语义匹配

### 2. 工具箱系统（Toolbox System）

**文件**: `src/toolboxes.ts`

工具箱是粗粒度的能力分组，与工具的 `toolbox` 字段对应：

| ID | 名称 | 包含工具 |
|----|------|---------|
| `file_read` | 文件读取 | `read_file` |
| `file_write` | 文件写入 | `write_file`, `edit_file` |
| `dir_ops` | 目录操作 | `list_dir`, `create_dir`, `move_file`, `copy_file`, `delete_file` |
| `exec` | 命令执行 | `exec_command` |
| `web` | 网络访问 | `fetch_url` |
| `core` | 核心能力 | `get_time` |

**筛选规则**:
- 工具的 `toolbox` 字段在 `requiredToolboxes` 中 → 包含
- 工具的 `toolbox` 未设置 → 始终包含（核心能力）
- `requiredToolboxes` 为空 → 返回全部工具

### 3. 技能系统（Skill System）

**文件**: `src/core/skill-registry.ts`, `src/core/skill-loader.ts`

技能系统是 v4 新增的模块化扩展机制。

#### 架构层次

```
Skill Package（技能包）
├── SKILL.md（人类可读文档）
├── index.ts（导出 Skill[]）
└── <skill-id>/
    ├── SKILL.md（技能文档）
    └── tools.ts（工具定义）

Skill（技能）
├── tools → 注册到 ToolRegistry
├── toolboxes → 合并到 Toolbox 列表
├── systemPrompt → 追加到 system prompt
└── skillMd → 人类可读文档
```

#### 加载流程

```
CLI 启动
  → 确定 skills/ 目录路径
    → discoverSkillPackages()
      → 扫描一级子目录（每个 = SkillPackage）
        → 读取 SKILL.md，解析 front matter
        → 导入 index.ts，获取 Skill[]
        → 扫描 skills/ 子目录，动态加载子技能
    → skillRegistry.registerPackage(pkg)
    → 合并 contributed tools → ToolRegistry
    → 合并 contributed toolboxes → 工具箱列表
```

#### 创建自定义技能

见 `skills/README.md`。

### 4. 双层配置系统

**文件**: `src/core/config.ts`

```
ModelConfig（模型层）
├── baseUrl, model
├── temperature, topP, maxTokens
├── thinkingLevel, thinkingBudget
└── contextWindow, stream, retryCount

AgentConfig（Agent 层）
├── maxTurns, toolTimeout
├── contextReserveRatio, overflowStrategy
├── toolSelectionStrategy
├── compressMessages, allowParallelTools
├── responseLanguage, responseFormat
└── debug, logTokenUsage, logFile
```

**配置预设**:

| 预设 | maxTurns | timeout | thinking |
|------|----------|---------|----------|
| `fast` | 3 | 15s | 禁用 |
| `balanced`（默认） | 5 | 30s | 轻度 |
| `deep` | 15 | 60s | 深度 |

**合并优先级**（从低到高）:
1. `getDefaultAgentConfig()` — 默认值
2. `runAgent(options.agentConfig)` — 用户传入
3. `plan.suggestedConfig` — 规划器推荐

### 5. 工具注册表（ToolRegistry）

**文件**: `src/core/registry.ts`

管理所有工具的生命周期：

- `register(name, tool)` — 注册工具
- `unregister(name)` — 注销工具
- `get(name)` — 查询工具
- `getAll()` — 获取全部工具
- `getSchemas()` — 提取 OpenAI schema
- `getSchemasByToolboxes(ids)` — 按工具箱筛选 schema
- `getByToolboxes(ids)` — 按工具箱筛选完整工具对象

内部使用 `Map<string, RegisteredTool>` 存储。

### 6. 安全设计

**文件**: `src/security/sandbox.ts`

#### 路径沙箱

```
resolveSandboxPath(inputPath, allowedDirs)
  → path.resolve(inputPath) → 转为绝对路径
  → 遍历 allowedDirs → 检查是否在允许范围内
  → 通过 → 返回绝对路径 / 拒绝 → 抛出 Error
```

#### 工具权限分级

| 权限 | 说明 | 示例 |
|------|------|------|
| `sandbox` | 只能在 allowedPaths 内操作 | read_file, write_file |
| `allowlist` | 需要命令白名单验证 | exec_command |
| `require-confirm` | 必须用户确认 | delete_file |

#### 命令执行安全

- 危险命令过滤（`rm -rf /`, `mkfs` 等）
- 超时强制终止（SIGKILL）
- 分别捕获 stdout/stderr

### 7. 性能监控

**文件**: `src/core/monitor.ts`

自动记录每次工具调用的：
- 调用次数
- 总耗时 / 平均耗时
- 成功 / 失败次数

通过 `.stats` 命令查看报告。

### 8. 输出管理

**文件**: `src/core/output-manager.ts`

解决 readline 与异步输出的冲突：

```
异步操作前 → beginOutput()
  → pause readline
  → clear current line
  → output content
异步操作后 → endOutput()
  → redraw prompt
  → resume readline
```

支持嵌套调用（计数器模式），避免重复清除。

### 9. 增量日志

**文件**: `src/core/logger.ts`

将 LLM 输入/输出增量追加到指定文件：
- 每行一个 JSON 对象
- 支持 truncation 防止日志膨胀
- 通过 `.log <路径>` 命令开启

## 数据流

```
用户输入
  ↓
CLI (cli.ts)
  ├── OutputManager.beginOutput()
  ↓
runAgent() (agent.ts)
  ├── Phase 1: generatePlan() (planner.ts)
  │     ├── 构建 messages [system + user]
  │     ├── 调用 LLM → StructuredPlan
  │     └── 合并配置 (config.ts)
  ↓
  ├── Phase 2: executePlan() (agent.ts)
  │     ├── 筛选工具 (registry.ts)
  │     ├── ReAct 循环
  │     │     ├── LLM → 工具调用
  │     │     ├── 查找工具 (registry.get())
  │     │     ├── 执行工具 (tool.handler())
  │     │     │     ├── 路径验证 (sandbox.ts)
  │     │     │     └── 实际执行 (fs/spawn/fetch)
  │     │     ├── 记录性能 (monitor.ts)
  │     │     └── 结果追加到消息
  │     └── 返回最终回复
  ↓
  ├── OutputManager.write(reply)
  └── OutputManager.endOutput()
```

## 扩展点

### 添加新工具

1. 在 `src/tools/` 创建新文件
2. 定义 schema + handler + permission
3. 在 `cli.ts` 中注册到 registry

### 添加新技能

1. 在 `skills/` 创建新目录
2. 编写 `SKILL.md` + `index.ts`
3. （可选）添加 `tools.ts` 贡献新工具

### 添加新工具箱

1. 在 `src/toolboxes.ts` 添加定义
2. 在工具的 `toolbox` 字段中引用

## 依赖关系

```
cli.ts
  ├── agent.ts ─── planner.ts ─── logger.ts
  │     ├── registry.ts
  │     ├── monitor.ts
  │     ├── config.ts
  │     └── sandbox.ts
  ├── skill-registry.ts
  ├── skill-loader.ts ─── types.ts
  ├── output-manager.ts
  └── toolboxes.ts
```

## 版本演进

| 版本 | 核心特性 |
|------|---------|
| v1 | 基础 ReAct 循环 + 3 类工具 |
| v2 | 注册表 + 监控器 + 沙箱 |
| v3 | 两阶段架构 + 工具箱 + 配置系统 |
| v4 | 技能系统 + 输出管理器 |
