# Mini Agent

A minimal LLM agent with **tool calling** support — the ReAct loop implemented in TypeScript.

No heavy frameworks. No boilerplate. Just a clean architecture that **goes beyond OpenClaw**.

## Features

- 🧠 **Enhanced ReAct Loop** — LLM → tool call → execute → result → response
- 🔧 **Dynamic Tool Registry** — Register/unregister tools at runtime
- 📊 **Performance Monitor** — Track tool usage, speed, and success rates
- 🔒 **Path Sandbox** — File operations restricted to allowed directories
- 🛡️ **3-Level Permissions** — `sandbox` / `allowlist` / `require-confirm`
- 📦 **Cross-Platform** — Build standalone executables for Win/Mac/Linux
- 🧪 **Typed** — Full TypeScript support

## Architecture

```
src/
├── core/
│   ├── agent.ts       # ReAct loop (registry + monitor)
│   ├── registry.ts    # Dynamic tool registry
│   ├── monitor.ts     # Tool performance tracking
│   └── types.ts       # Type definitions
├── tools/
│   ├── filesystem.ts  # 8 tools: read/write/edit/list/create/move/copy/delete
│   ├── exec.ts        # 1 tool: command execution (timeout/PTY)
│   └── web.ts         # 2 tools: web fetch + time
├── security/
│   └── sandbox.ts     # Path validation
├── cli.ts             # Interactive CLI
└── index.ts           # Barrel exports
```

## Tools

| Category | Tools |
|----------|-------|
| **文件** | `read_file`, `write_file`, `edit_file`, `list_dir`, `create_dir`, `move_file`, `copy_file`, `delete_file` |
| **命令** | `exec_command` |
| **网络** | `fetch_url`, `get_time` |

**11 个工具** — 全部开箱即用，无需外部服务。

## Quick Start

```bash
# 1. Clone & install
git clone https://github.com/yingzhudashu/mini-agent.git
cd mini-agent
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your API key

# 3. Run
npm start       # Interactive chat
npm test        # Run integration tests
```

### CLI Commands

Inside the interactive chat:
- `.tools` — List all available tools
- `.stats` — Show tool usage statistics
- `quit` / `exit` — Exit

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your API key | *(required)* |
| `OPENAI_BASE_URL` | API endpoint | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model name | `gpt-4o-mini` |
| `MINI_AGENT_WORKSPACE` | Allowed workspace root | `process.cwd()` |

### Example Configurations

**OpenAI:**
```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

**DashScope (百炼):**
```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_MODEL=qwen-plus
```

## Building Standalone Executables

Build platform-specific binaries that **don't require Node.js**:

```bash
npm run pkg:win    # Windows (.exe)
npm run pkg:mac    # macOS (Intel + Apple Silicon)
npm run pkg:linux  # Linux (x64 + ARM64)
npm run pkg:all    # All platforms
```

Output files are saved to `dist/`.

## API Usage

```typescript
import {
  runAgent,
  DefaultToolRegistry,
  DefaultToolMonitor,
  filesystemTools,
  execTools,
  webTools,
} from "./src/index.js";

// Setup
const registry = new DefaultToolRegistry();
const monitor = new DefaultToolMonitor();

for (const [n, t] of Object.entries(filesystemTools)) registry.register(n, t);
for (const [n, t] of Object.entries(execTools)) registry.register(n, t);
for (const [n, t] of Object.entries(webTools)) registry.register(n, t);

// Run
const reply = await runAgent("读取 package.json", {
  registry,
  monitor,
});
```

### Adding New Tools

```typescript
import type { ToolDefinition } from "./src/core/types.js";

const myTool: ToolDefinition = {
  schema: { /* OpenAI tool schema */ },
  handler: async (args, ctx) => ({ success: true, content: "Hello!" }),
  permission: "sandbox",
  help: "我的工具",
};

registry.register("my_tool", myTool);
```

## License

MIT
