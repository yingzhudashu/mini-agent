# Mini Agent v3 🦾

> 基于 TypeScript 的最小化 LLM Agent，支持工具调用与两阶段规划架构。

## 架构总览

Mini Agent 采用 **两阶段架构（Plan-then-Execute）**：

```
┌─────────────────────────────────────────────────────┐
│                     用户输入                          │
│                      ↓                              │
│  ┌─────────────────────────────────────────────┐    │
│  │  Phase 1: Planning（规划阶段）                │    │
│  │                                              │    │
│  │  输入: 用户需求 + 6 个工具箱描述               │    │
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
│  │    思考 → 工具调用 → 执行 → 反馈 → 循环        │    │
│  │                                              │    │
│  │  工具筛选:                                    │    │
│  │    只发送 plan.requiredToolboxes 中的工具       │    │
│  │    减少 LLM 输入 token 消耗                     │    │
│  └──────────────────────┬──────────────────────┘    │
│                         ↓                            │
│                      最终回复                         │
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

# 工作空间（可选，默认当前目录）
# MINI_AGENT_WORKSPACE=/path/to/workspace
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

### CLI 命令

| 命令 | 说明 |
|------|------|
| `任意文本` | 正常两阶段模式（规划 → 执行） |
| `.plan <内容>` | 跳过规划直接执行 |
| `.stats` | 查看工具使用统计 |
| `quit` / `exit` | 退出 |

## 核心架构

### 工具箱（Toolbox）

v3 引入 **工具箱** 概念，将 11 个细粒度工具分为 6 个能力组：

| 工具箱 ID | 名称 | 包含工具 | 说明 |
|-----------|------|---------|------|
| `file_read` | 文件读取 | `read_file` | 只读文件内容 |
| `file_write` | 文件写入 | `write_file`, `edit_file` | 创建/修改文件 |
| `dir_ops` | 目录操作 | `list_dir`, `create_dir`, `move_file`, `copy_file`, `delete_file` | 文件系统管理 |
| `exec` | 命令执行 | `exec_command` | shell 命令 |
| `web` | 网络访问 | `fetch_url` | 网页抓取 |
| `core` | 核心能力 | `get_time` | 基础内置能力 |

**为什么保持工具细粒度？**
- 每个工具功能单一明确，LLM 调用准确率高
- 权限控制精确到单个工具（如 `delete_file` 需确认）
- 工具箱只是**筛选分组**，不合并工具本身

### 双层配置

```
┌─────────────────────────────────────┐
│  ModelConfig（模型层）                │
│  - API 端点、模型名称                 │
│  - temperature / top_p              │
│  - max_tokens                       │
│  - thinking_level / thinking_budget  │
│  - context_window                   │
│  └─ 来源：.env / 模型厂商推荐         │
└──────────────┬──────────────────────┘
               ↓
┌─────────────────────────────────────┐
│  AgentConfig（Agent 层）              │
│  - max_turns                        │
│  - tool_timeout                     │
│  - context_reserve_ratio (0.8)      │
│  - overflow_strategy                │
│  - tool_selection_strategy          │
│  └─ 可被规划器的 suggestedConfig 覆盖  │
└─────────────────────────────────────┘
```

**配置预设：**

| 预设 | 场景 | maxTurns | timeout | thinking |
|------|------|----------|---------|----------|
| `fast` | 简单问答 | 3 | 15s | 禁用 |
| `balanced` | 日常任务（默认） | 5 | 30s | 轻度 |
| `deep` | 复杂多步 | 15 | 60s | 深度 |

**配置合并优先级：**
1. `getDefaultAgentConfig()` — 默认值
2. `runAgent(options.agentConfig)` — 用户传入
3. `plan.suggestedConfig` — 规划器推荐（最高）

### 上下文管理

当预估 token 消耗超出上下文窗口时：

| 策略 | 说明 |
|------|------|
| `summarize` | 压缩早期消息（默认） |
| `truncate` | 截断最早的消息 |
| `error` | 报错终止 |
| `chunked` | 分块执行（大型任务） |

`contextReserveRatio: 0.8` 表示预留 20% 窗口给 LLM 输出和工具结果。

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
│   │   ├── types.ts       # 类型定义（Toolbox, StructuredPlan, Config 等）
│   │   ├── config.ts      # 配置管理（预设、合并）
│   │   ├── planner.ts     # Phase 1: 规划器
│   │   ├── agent.ts       # Phase 2: ReAct 循环 + 主入口
│   │   ├── registry.ts    # 工具注册表
│   │   └── monitor.ts     # 性能监控器
│   ├── tools/
│   │   ├── filesystem.ts  # 8 个文件操作工具
│   │   ├── exec.ts        # 命令执行工具
│   │   └── web.ts         # 网页抓取 + 时间工具
│   ├── security/
│   │   └── sandbox.ts     # 路径沙箱
│   ├── toolboxes.ts       # 6 个默认工具箱定义
│   ├── cli.ts             # CLI 交互入口
│   └── index.ts           # 统一导出
├── tests/
│   └── test.ts            # 集成测试
├── .env.example           # 环境变量模板
├── .gitignore
├── package.json
└── README.md
```

## 作为库使用

```typescript
import {
  runAgent,
  DefaultToolRegistry,
  DefaultToolMonitor,
  DEFAULT_TOOLBOXES,
  filesystemTools,
  execTools,
  webTools,
  MODEL_PRESETS,
} from "mini-agent";

// 初始化
const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();
for (const [name, tool] of Object.entries(filesystemTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(execTools)) registry.register(name, tool);
for (const [name, tool] of Object.entries(webTools)) registry.register(name, tool);

// 执行
const reply = await runAgent("帮我创建 README.md", {
  registry,
  monitor,
  toolboxes: DEFAULT_TOOLBOXES,
  onToolCall: (name, args, result) => console.log(`${name}: ${result}`),
});
```

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run build

# 测试
npm test

# 类型检查（不输出文件）
npm run lint

# 打包为可执行文件
npm run pkg:all    # Win + macOS + Linux
```

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v3 | 2026-04-30 | 两阶段架构、工具箱、配置系统、规划器 |
| v2 | 2026-04-29 | 注册表、监控器、沙箱、性能优化 |
| v1 | 2026-04-28 | 基础 ReAct 循环、文件/命令/网络工具 |

## License

MIT
