# Mini Agent v4.1 🦾

> 基于 TypeScript 的最小化 LLM Agent，支持工具调用、两阶段规划、技能扩展与循环检测。

## 架构总览

Mini Agent 采用 **两阶段架构（Plan-then-Execute）** + **技能系统（Skill System）** + **循环检测（Loop Detection）**：

```
┌─────────────────────────────────────────────────────┐
│                     用户输入                          │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐    │
│  │  Phase 1: Planning（规划阶段）                │    │
│  │                                              │    │
│  │  输入: 用户需求 + 工具箱描述（内置+技能）       │    │
│  │  LLM: qwen3.6-plus (temperature=0.3)         │    │
│  │  输出: StructuredPlan                        │    │
│  │    - 步骤分解                                  │    │
│  │    - 所需工具箱                                │    │
│  │    - 配置推荐（maxTurns, timeout 等）          │    │
│  │    - Token 预估 & 风险等级                    │    │
│  │    - 是否需要用户确认                          │    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│  ┌─────────────────────────────────────────────┐    │
│  │  Phase 2: Execution（执行阶段）               │    │
│  │                                              │    │
│  │  ReAct 循环:                                 │    │
│  │    循环检测 → 思考 → 工具调用 → 执行 → 反馈   │    │
│  │    上下文压缩 → 循环                           │    │
│  │                                              │    │
│  │  工具筛选:                                    │    │
│  │    只发送 plan.requiredToolboxes 中的工具       │    │
│  │    减少 LLM 输入 token 消耗                     │    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│                      最终回复                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  技能系统 + 技能市场（Skill System + ClawHub）        │
│                                                     │
│  skills/                                            │
│  ├── default/                                       │
│  │   ├── SKILL.md                                   │
│  │   └── index.ts → exports Skill[]                 │
│  └── demo/                                          │
│      ├── SKILL.md                                   │
│      ├── index.ts                                   │
│      └── hello_demo tool                            │
│                                                     │
│  技能市场 (ClawHub):                                  │
│  • .skill search <query>  → 搜索在线技能              │
│  • .skill install <slug>  → 安装技能                  │
│  • .skill list            → 列出已安装技能             │
│                                                     │
│  每个技能可贡献:                                      │
│  • 工具定义 → 注册到 ToolRegistry                     │
│  • 工具箱 → 合并到规划阶段可用的工具箱列表              │
│  • 系统提示词 → 追加到 Agent 的 system prompt         │
│  • Gating 元数据 → 按 bin/env/config 过滤             │
└─────────────────────────────────────────────────────┘
```

## 快速开始

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
OPENAI_API_KEY=your-api-key-here

# 模型名称
OPENAI_MODEL=qwen3.6-plus

# 模型预设（可选：creative | balanced | precise | code | fast）
MODEL_PROFILE=balanced

# 工作空间（可选，默认当前目录）
# MINI_AGENT_WORKSPACE=/path/to/workspace

# 技能目录（可选，默认 <项目根目录>/skills）
# MINI_AGENT_SKILLS=/path/to/skills
```

### 运行

```bash
# 交互式 CLI
npm start

# 运行测试
npm test

# 编译为 JS
npm run build
```

### CLI 命令参考

| 命令 | 说明 |
|------|------|
| `任意文本` | 正常两阶段模式（规划 → 执行） |
| `.plan <内容>` | 跳过规划，直接执行 |
| `.stats` | 查看工具使用统计 |
| `.skills` | 查看已加载的技能列表 |
| `.profile [name]` | 查看/切换模型预设 |
| `.skill search <q>` | 搜索 ClawHub 技能 |
| `.skill install <s>` | 安装技能 |
| `.skill list` | 列出已安装技能 |
| `.log <路径>` | 开启增量日志到指定文件 |
| `quit` / `exit` | 退出 |

## 核心架构

### 工具箱（Toolbox）

将 11 个细粒度工具分为 6 个能力组：

| 工具箱 ID | 名称 | 包含工具 | 说明 |
|-----------|------|---------|------|
| `file_read` | 文件读取 | `read_file` | 只读文件内容 |
| `file_write` | 文件写入 | `write_file`, `edit_file` | 创建/修改文件 |
| `dir_ops` | 目录操作 | `list_dir`, `create_dir`, `move_file`, `copy_file`, `delete_file` | 文件系统管理 |
| `exec` | 命令执行 | `exec_command` | shell 命令 |
| `web` | 网络访问 | `fetch_url` | 网页抓取 |
| `core` | 核心能力 | `get_time`, `search_skills`, `install_skill`, `list_skills` | 基础内置能力 + 技能管理 |

### 技能系统（Skill System）

可插拔的模块化扩展机制。

#### Agent 自主技能管理

v4.1 新增：**Agent 可以自己搜索和安装技能了！**

Agent 拥有以下工具：

| 工具 | 说明 |
|------|------|
| `search_skills` | 搜索 ClawHub 技能市场或本地已安装的技能 |
| `install_skill` | 从 ClawHub 下载并安装技能（需用户确认） |
| `list_skills` | 列出所有已安装的本地技能 |

当用户说"帮我找一个 XX 技能"或"安装 XX 技能"时，Agent 会自动调用这些工具。

#### 目录结构

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
        └── tools.ts           # 工具定义
```

#### Gating 机制

技能可通过 metadata 设置 gating 条件：

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
| `os` | 适用的操作系统 |
| `always` | 始终可用（跳过所有 gate） |

### 模型预设（Model Profiles）

针对不同任务类型提供预调优的参数组合：

| 预设 | 场景 | temperature | maxTokens | thinking |
|------|------|-------------|-----------|----------|
| `creative` | 创造性任务 | 0.9 | 8192 | 禁用 |
| `balanced` | 日常任务（默认） | 0.7 | 4096 | 轻度 |
| `precise` | 精确模式 | 0.3 | 4096 | 中等 |
| `code` | 编程模式 | 0.2 | 8192 | 轻度 |
| `fast` | 快速模式 | 0.3 | 2048 | 禁用 |

使用 `.profile <name>` 切换预设。

### 循环检测（Loop Detection）

参考 OpenClaw 的 loop-detection 机制，防止 Agent 陷入无限循环：

| 检测器 | 检测模式 | 默认阈值 |
|--------|---------|----------|
| `genericRepeat` | 相同工具 + 相同参数 | 警告 5 / 终止 8 |
| `knownPollNoProgress` | 轮询但结果无变化 | 警告 5 / 终止 8 |
| `pingPong` | A→B→A→B 交替 | 警告 6 |

被检测到时：
- **Warning**: 显示警告消息，继续执行
- **Critical**: 强制终止循环，返回错误信息

### 上下文管理

当消息超过 12 条时，自动压缩中间历史，保留首尾各 4 条：

| 策略 | 说明 |
|------|------|
| `summarize` | 压缩早期消息（默认） |
| `truncate` | 截断最早的消息 |
| `error` | 报错终止 |

### 安全设计

| 层级 | 措施 | 说明 |
|------|------|------|
| 路径沙箱 | `resolveSandboxPath()` | 文件操作限制在允许的目录内 |
| 工具权限 | `sandbox` / `allowlist` / `require-confirm` | 分级控制执行条件 |
| 命令过滤 | 危险命令黑名单 | `rm -rf /`、`mkfs` 等被拦截 |
| 超时保护 | 每工具独立计时器 | 防止阻塞 Agent |
| 规划确认 | `onPlan` 回调 | 高风险操作需用户批准 |

## 项目结构

```
mini-agent/
├── src/
│   ├── core/
│   │   ├── types.ts           # 类型定义（含 ClawHub/LoopDetection）
│   │   ├── config.ts          # 配置管理（预设、循环检测默认值）
│   │   ├── planner.ts         # Phase 1: 规划器
│   │   ├── agent.ts           # Phase 2: ReAct + 循环检测 + 上下文
│   │   ├── registry.ts        # 工具注册表
│   │   ├── monitor.ts         # 性能监控器
│   │   ├── logger.ts          # 增量日志写入器
│   │   ├── output-manager.ts  # CLI 输出管理器
│   │   ├── loop-detector.ts   # 循环检测器（v4.1 新增）
│   │   ├── clawhub-client.ts  # ClawHub 客户端（v4.1 新增）
│   │   ├── skill-registry.ts  # 技能注册表（含 gating）
│   │   └── skill-loader.ts    # 技能包自动发现与加载
│   ├── tools/
│   │   ├── filesystem.ts      # 8 个文件操作工具
│   │   ├── exec.ts            # 命令执行工具
│   │   ├── web.ts             # 网页抓取 + 时间工具
│   │   └── skills.ts          # 技能管理工具（v4.1.1 新增）
│   ├── security/
│   │   └── sandbox.ts         # 路径沙箱
│   ├── toolboxes.ts           # 7 个默认工具箱定义
│   ├── cli.ts                 # CLI 交互入口
│   └── index.ts               # 统一导出
├── skills/
│   └── default/               # 默认技能包
├── docs/
│   └── ARCHITECTURE.md        # 详细架构文档
├── tests/
│   └── test.ts                # 集成测试
├── .env.example               # 环境变量模板
├── package.json
└── README.md
```

## 作为库使用

```typescript
import {
  runAgent,
  DefaultToolRegistry,
  DefaultToolMonitor,
  DefaultSkillRegistry,
  DEFAULT_TOOLBOXES,
  MODEL_PROFILES,
  DEFAULT_LOOP_DETECTION,
  LoopDetector,
  createClawHubClient,
  searchLocalSkills,
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

// 注册内置工具
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(skillsTools)) registry.register(name, tool);

// 加载技能包
const packages = await discoverSkillPackages("./skills");
for (const pkg of packages) {
  skillRegistry.registerPackage(pkg);
}

// 合并工具箱
const allToolboxes = [...DEFAULT_TOOLBOXES, ...skillRegistry.getAllToolboxes()];

// 执行
const reply = await runAgent("帮我创建 README.md", {
  registry,
  monitor,
  toolboxes: allToolboxes,
  systemPrompt: skillRegistry.getSystemPrompts().join("\n\n"),
});
```

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run build

# 类型检查
npm run lint

# 测试
npm test

# 打包为可执行文件
npm run pkg:all    # Win + macOS + Linux
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v4.1.1 | 2026-05-01 | Agent 自主技能管理（search_skills/install_skill/list_skills） |
| v4.1 | 2026-05-01 | 循环检测、模型预设、ClawHub 集成、上下文压缩 |
| v4 | 2026-05-01 | 技能系统、输出管理器、文档完善 |
| v3 | 2026-04-30 | 两阶段架构、工具箱、配置系统、规划器 |
| v2 | 2026-04-29 | 注册表、监控器、沙箱、性能优化 |
| v1 | 2026-04-28 | 基础 ReAct 循环、文件/命令/网络工具 |

## License

MIT
