# Mini Agent v4.9 🦾

> 基于 TypeScript 的最小化 LLM Agent 框架，支持两阶段规划、技能扩展、记忆管理、飞书集成与自我优化。

## ✨ 特性

- **两阶段规划（Plan → Execute）**：先分解任务为结构化计划，再按步骤执行，提升复杂任务处理质量
- **技能系统（Skills）+ ClawHub 技能市场**：可插拔的模块化扩展机制，支持在线搜索与安装技能包
- **跨会话记忆（Memory Store + 关键词索引）**：持久化对话摘要与关键事实，支持语义检索
- **飞书集成**：WebSocket 长轮询 / Webhook 双模式，无需公网 IP 即可接入
- **自我优化（Auto-Optimize）**：代码质量审视、外部调研、风险分级提案、Git 快照保护 + 自动回滚
- **多会话管理（Session Manager）**：独立的 Agent 执行上下文，支持工具升维/降维
- **路径沙箱（Sandbox）**：文件操作限制在允许的目录内，防止越权访问
- **循环检测（Loop Detection）**：防止 Agent 陷入无限循环（genericRepeat / knownPollNoProgress / pingPong）
- **模型预设（Model Profiles）**：creative / balanced / precise / code / fast，开箱即用

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 安装

```bash
git clone https://github.com/yingzhudashu/mini-agent.git
cd mini-agent
npm install
```

### 配置

创建 `.env` 文件：

```env
# API 端点（DashScope 百炼）
OPENAI_BASE_URL=https://coding.dashscope.aliyuncs.com/v1

# API 密钥
OPENAI_API_KEY=sk-xxx

# 模型名称
OPENAI_MODEL=qwen3.6-plus

# 模型预设（可选：creative | balanced | precise | code | fast）
MODEL_PROFILE=balanced

# 工作空间（可选，默认当前工作目录）
# MINI_AGENT_WORKSPACE=/path/to/workspace

# 技能目录（可选，默认 <项目根目录>/skills）
# MINI_AGENT_SKILLS=/path/to/skills

# 状态目录（可选，默认 <工作空间>/.mini-agent-state）
# MINI_AGENT_STATE=/path/to/state
```

### 运行

```bash
# 交互式 CLI（两阶段模式）
npm start

# 飞书长轮询服务器
npm run feishu

# 运行测试
npm test

# 类型检查（编译验证）
npm run lint

# 编译为 JS
npm run build

# 停止运行中的实例
npm run stop
```

### CLI 命令参考

| 命令 | 说明 |
|------|------|
| `任意文本` | 正常两阶段模式（规划 → 执行） |
| `.plan <内容>` | 跳过规划，直接执行 |
| `.stats` | 查看工具使用统计 |
| `.skills` | 查看已加载的技能列表 |
| `.profile [name]` | 查看/切换模型预设 |
| `.skill search <q>` | 搜索 ClawHub 技能市场 |
| `.skill install <s>` | 安装技能 |
| `.skill list` | 列出已安装技能 |
| `.log <路径>` | 开启增量日志到指定文件 |
| `.optimize` | 自我优化（inspect/research/propose/auto） |
| `quit` / `exit` | 退出 |

## 📁 项目结构

```
mini-agent/
├── src/
│   ├── types/              # 类型定义（7 个文件）
│   │   ├── agent.ts        # Agent 运行结果、统计、循环检测、管线
│   │   ├── config.ts       # 双层配置体系（ModelConfig / AgentConfig）
│   │   ├── memory.ts       # 记忆存储 + 会话管理类型
│   │   ├── skill.ts        # 技能系统 + ClawHub 技能市场
│   │   ├── tool.ts         # 工具系统 + 上下文管理
│   │   ├── planning.ts     # 规划系统（PlanStep / StructuredPlan）
│   │   ├── feishu.ts       # 飞书集成类型
│   │   └── index.ts        # 统一导出（barrel）
│   │
│   ├── core/               # 核心引擎
│   │   ├── agent.ts        # Agent 运行（ReAct + 循环检测 + 上下文）
│   │   ├── config.ts       # 配置管理（预设、循环检测默认值）
│   │   ├── clawhub-client.ts# ClawHub 技能市场客户端
│   │   ├── instance-manager.ts # 单实例锁管理（PID 文件）
│   │   ├── keyword-index.ts # 轻量语义记忆检索（倒排索引）
│   │   ├── logger.ts       # 增量 JSON 日志写入器
│   │   ├── memory-store.ts # 跨会话记忆持久化
│   │   ├── planning.ts     # LLM 驱动的任务规划器
│   │   ├── registry.ts     # 工具注册表
│   │   ├── monitor.ts      # 性能监控器（工具调用统计）
│   │   ├── skill-loader.ts # 技能包自动发现与加载
│   │   ├── skill-registry.ts # 技能注册表（含 gating）
│   │   ├── executor.ts     # LLM API 调用 + 工具执行编排
│   │   ├── context-manager.ts # 上下文压缩与管理
│   │   ├── output-manager.ts # CLI 输出格式化
│   │   └── self-opt/       # 自我优化子系统（v4.2+）
│   │       ├── types.ts           # 自我优化类型
│   │       ├── inspector.ts       # 代码质量审视引擎
│   │       ├── researcher.ts      # 外部调研引擎（arXiv + GitHub）
│   │       ├── proposal-engine.ts # 优化提案引擎
│   │       ├── auto-optimizer.ts  # 全自动优化编排
│   │       ├── diff-generator.ts  # LLM 修复补丁生成器
│   │       ├── self-test-runner.ts# 自动测试执行器
│   │       └── git-snapshot.ts    # Git 快照管理器
│   │
│   ├── session/            # 会话管理（v4.7+）
│   │   ├── manager.ts      # SessionManager（创建/销毁/切换）
│   │   ├── workspace.ts    # WorkspaceManager（工作空间隔离）
│   │   └── index.ts        # 统一导出
│   │
│   ├── tools/              # 工具实现
│   │   ├── filesystem.ts   # 8 个文件操作工具
│   │   ├── exec.ts         # Shell 命令执行
│   │   ├── web.ts          # 网页抓取 + 时间工具
│   │   └── skills.ts       # 技能管理工具
│   │
│   ├── feishu/             # 飞书集成（v4.5+）
│   │   ├── agent-handler.ts # 消息 → Agent → 回复
│   │   ├── poll-server.ts   # WebSocket 长轮询服务器
│   │   └── server.ts        # Webhook HTTP 服务器
│   │
│   ├── security/           # 安全模块
│   │   └── sandbox.ts      # 路径沙箱
│   │
│   ├── utils/              # 公共工具（v4.9+）
│   │   ├── fs.ts           # 目录创建、状态路径、默认工作空间
│   │   └── index.ts        # 统一导出
│   │
│   ├── cli/                # CLI 子系统
│   │   └── cli.ts          # 交互式 CLI 主入口
│   │
│   ├── feishu-cli.ts       # 飞书长轮询启动脚本
│   ├── index.ts            # 主 barrel（库使用入口）
│   └── toolboxes.ts        # 7 个默认工具箱定义
│
├── skills/                 # 技能包目录
│   └── default/            # 默认技能包
│       ├── SKILL.md
│       └── index.ts
│
├── tests/                  # 测试
│   ├── test.ts             # 集成测试
│   ├── cli.test.ts
│   └── types.test.ts
│
├── .env.example            # 环境变量模板
├── package.json
└── tsconfig.json
```

## 📝 配置说明

### 环境变量

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_BASE_URL` | ✅ | LLM API 端点 | — |
| `OPENAI_API_KEY` | ✅ | API 密钥 | — |
| `OPENAI_MODEL` | ✅ | 模型名称 | `qwen3.6-plus` |
| `MODEL_PROFILE` | ❌ | 模型预设 | `balanced` |
| `MINI_AGENT_WORKSPACE` | ❌ | 工作空间根目录 | `process.cwd()` |
| `MINI_AGENT_SKILLS` | ❌ | 技能目录 | `<workspace>/skills` |
| `MINI_AGENT_STATE` | ❌ | 状态目录 | `<workspace>/.mini-agent-state` |
| `FEISHU_APP_ID` | ❌ | 飞书 App ID（飞书模式必填） | — |
| `FEISHU_APP_SECRET` | ❌ | 飞书 App Secret（飞书模式必填） | — |

### config.json

每个会话工作空间下可包含 `config.json`，覆盖全局配置：

| 字段 | 类型 | 说明 |
|------|------|------|
| `maxTurns` | number | 最大 ReAct 轮次 |
| `timeoutMs` | number | 单轮超时（毫秒） |
| `temperature` | number | 采样温度 |
| `maxTokens` | number | 最大输出 token |
| `toolSelectionStrategy` | string | 工具筛选策略（`all` / `toolbox` / `auto`） |
| `allowedTools` | string[] | 工具白名单 |
| `sessionToolboxes` | Toolbox[] | 会话级工具箱 |

## 📲 飞书集成指南

### 1. 创建飞书应用

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 创建**企业自建应用**
3. 记录 `App ID` 和 `App Secret`

### 2. 配置事件订阅

1. 进入应用 → **事件与回调** → **事件订阅**
2. 添加事件：`im.message.receive_v1`（接收消息）
3. 订阅方式选择**长连接**（Receive events through persistent connection）
4. ⚠️ **不需要配置请求地址**，长轮询模式无需公网 IP

### 3. 配置权限

确保应用拥有以下权限：
- `im:message` — 获取与发送消息
- `im:message:send_as_bot` — 以 Bot 身份发送消息

### 4. 启动

```env
# .env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxx…xxxx
```

```bash
npm run feishu
```

### 架构

```
飞书用户 → 飞书开放平台 → WebSocket 长轮询 → Mini Agent → 回复消息
```

| 模式 | 文件 | 说明 |
|------|------|------|
| 长轮询（推荐） | `src/feishu/poll-server.ts` | WebSocket 连接，无需公网 IP |
| Webhook（备用） | `src/feishu/server.ts` | HTTP 回调，需要公网 IP |

## 🧩 技能系统

### 什么是技能

技能是可插拔的模块化能力单元。每个技能包可贡献：
- **工具定义** → 注册到 ToolRegistry
- **工具箱** → 合并到规划阶段可用的工具箱列表
- **系统提示词** → 追加到 Agent 的 system prompt
- **Gating 元数据** → 按 bin/env/config 条件过滤

### 目录结构

```
skills/
├── default/                    # 默认技能包
│   ├── SKILL.md               # 技能包文档
│   └── index.ts               # 导出 Skill[]
└── custom/                     # 自定义技能包
    ├── SKILL.md
    ├── index.ts
    └── my-tool/
        ├── SKILL.md
        └── tools.ts           # 工具定义 + 实现
```

### Gating 机制

技能可通过 metadata 设置可用性条件：

```markdown
---
name: my-skill
description: 描述
metadata: {"openclaw": {"requires": {"bins": ["git"], "env": ["API_KEY"]}}}
---
```

| 条件 | 说明 |
|------|------|
| `requires.bins` | 系统必须存在的二进制文件 |
| `requires.env` | 必须存在的环境变量 |
| `requires.config` | 必须为真的 AgentConfig 键 |
| `os` | 适用操作系统（`win32` / `darwin` / `linux`） |
| `always` | 始终可用（跳过所有 gate） |

### ClawHub 技能市场

在线搜索、下载、安装技能包：

```
.skill search <query>   # 搜索在线技能
.skill install <slug>   # 安装技能（需用户确认）
.skill list             # 列出已安装技能
```

## 🔧 核心架构

### 两阶段架构

```
用户输入
  ↓
┌──────────────────────────────────────┐
│ Phase 1: Planning（规划阶段）         │
│ 输入: 用户需求 + 工具箱描述            │
│ LLM: qwen3.6-plus (temp=0.3)        │
│ 输出: StructuredPlan                 │
│   - 步骤分解                            │
│   - 所需工具箱                          │
│   - Token 预估 & 风险等级              │
│   - 是否需要用户确认                    │
└──────────────┬───────────────────────┘
               ↓
┌──────────────────────────────────────┐
│ Phase 2: Execution（执行阶段）         │
│ ReAct 循环:                           │
│   循环检测 → 思考 → 工具调用 → 执行    │
│   上下文压缩 → 循环                    │
│ 工具筛选: 只发送计划中需要的工具        │
└──────────────┬───────────────────────┘
               ↓
            最终回复
```

### 工具箱（Toolbox）

将细粒度工具分为 6 个能力组：

| 工具箱 ID | 名称 | 包含工具 | 说明 |
|-----------|------|---------|------|
| `file_read` | 文件读取 | `read_file` | 只读文件内容 |
| `file_write` | 文件写入 | `write_file`, `edit_file` | 创建/修改文件 |
| `dir_ops` | 目录操作 | `list_dir`, `create_dir`, `move_file`, `copy_file`, `delete_file` | 文件系统管理 |
| `exec` | 命令执行 | `exec_command` | Shell 命令 |
| `web` | 网络访问 | `fetch_url` | 网页抓取 |
| `core` | 核心能力 | `get_time`, `search_skills`, `install_skill`, `list_skills` | 基础内置 + 技能管理 |

### 模型预设

| 预设 | 场景 | temperature | maxTokens | thinking |
|------|------|-------------|-----------|----------|
| `creative` | 创造性任务 | 0.9 | 8192 | 禁用 |
| `balanced` | 日常任务（默认） | 0.7 | 4096 | 轻度 |
| `precise` | 精确模式 | 0.3 | 4096 | 中等 |
| `code` | 编程模式 | 0.2 | 8192 | 轻度 |
| `fast` | 快速模式 | 0.3 | 2048 | 禁用 |

### 循环检测

| 检测器 | 检测模式 | 默认阈值 |
|--------|---------|----------|
| `genericRepeat` | 相同工具 + 相同参数 | 警告 5 / 终止 8 |
| `knownPollNoProgress` | 轮询但结果无变化 | 警告 5 / 终止 8 |
| `pingPong` | A→B→A→B 交替 | 警告 6 |

### 安全设计

| 层级 | 措施 | 说明 |
|------|------|------|
| 路径沙箱 | `resolveSandboxPath()` | 文件操作限制在允许的目录内 |
| 工具权限 | `sandbox` / `allowlist` / `require-confirm` | 分级控制执行条件 |
| 命令过滤 | 危险命令黑名单 | `rm -rf /`、`mkfs` 等被拦截 |
| 超时保护 | 每工具独立计时器 | 防止阻塞 Agent |
| 规划确认 | `onPlan` 回调 | 高风险操作需用户批准 |

### 自我优化系统（v4.2+）

通过 `.optimize` 指令触发：

| 指令 | 说明 |
|------|------|
| `.optimize` | 显示帮助信息 |
| `.optimize inspect` | 自我审视（代码质量 + 架构完整性） |
| `.optimize research` | 外部调研（arXiv + GitHub） |
| `.optimize propose` | 生成优化提案（按风险等级排序） |
| `.optimize auto` | 全自动优化（Git 快照 + 自动修复 + 回滚保护） |

风险等级：🟢 low（自动执行） / 🟡 medium（需确认） / 🔴 high（手动审核） / ⛔ destructive（禁止自动）

## 📦 作为库使用

```typescript
import {
  runAgent,
  DefaultToolRegistry,
  DefaultToolMonitor,
  DefaultSkillRegistry,
  DEFAULT_TOOLBOXES,
  MODEL_PROFILES,
  DEFAULT_LOOP_DETECTION,
  createClawHubClient,
  filesystemTools,
  execTools,
  webTools,
  skillsTools,
  discoverSkillPackages,
} from "mini-agent";

// 初始化
const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();
const skillRegistry = new DefaultSkillRegistry();

// 注册工具
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

// 加载技能
const packages = await discoverSkillPackages("./skills");
for (const pkg of packages) {
  skillRegistry.registerPackage(pkg);
}

// 执行
const reply = await runAgent("帮我创建 README.md", {
  registry,
  monitor,
  toolboxes: [...DEFAULT_TOOLBOXES, ...skillRegistry.getAllToolboxes()],
});
```

## 🔨 开发

```bash
npm install          # 安装依赖
npm run build        # 编译
npm run lint         # 类型检查
npm test             # 测试
npm run pkg:all      # 打包为可执行文件（Win + macOS + Linux）
```

## 📅 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v4.9 | 2026-05-04 | **架构优化 Phase 1-4**：删除冗余 re-export、合并 types 碎片（12→7）、提取公共工具函数 utils/fs、合并 feishu/types → types/feishu、完善 JSDoc 注释 |
| v4.8 | 2026-05-03 | 类型拆分 + 目录重组：core/types → types/、core/session → session/ |
| v4.7 | 2026-05-02 | 多会话管理（Session Manager + Workspace Manager） |
| v4.6 | 2026-05-02 | 跨会话记忆 + 关键词索引检索 |
| v4.5 | 2026-05-01 | 飞书集成 + 放宽调用限制（maxTurns 20、环境变量覆盖） |
| v4.4 | 2026-05-01 | 自我优化 Phase 5（Git 快照 + 自动修复 + 回滚保护） |
| v4.3 | 2026-05-01 | 自我优化 Phase 4（diff-generator + .optimize auto/propose） |
| v4.2 | 2026-05-01 | 自我优化 Phase 1-3（inspector + researcher + proposal-engine） |
| v4.1.1 | 2026-05-01 | Agent 自主技能管理（search_skills/install_skill/list_skills） |
| v4.1 | 2026-05-01 | 循环检测、模型预设、ClawHub 集成、上下文压缩 |
| v4.0 | 2026-05-01 | 技能系统、输出管理器 |
| v3.0 | 2026-04-30 | 两阶段架构、工具箱、配置系统、规划器 |
| v2.0 | 2026-04-29 | 注册表、监控器、沙箱、性能优化 |
| v1.0 | 2026-04-28 | 基础 ReAct 循环、文件/命令/网络工具 |

## License

MIT
