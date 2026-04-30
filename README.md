# Mini Agent

A minimal LLM agent with **tool calling** support — the ReAct loop implemented in TypeScript.

No heavy frameworks. No boilerplate. Just ~60 lines of core logic.

## Features

- 🧠 **ReAct Loop** — LLM → tool call → execute → result → response
- 🔧 **Tool Calling** — OpenAI-compatible function calling API
- 🌐 **Multi-Provider** — Works with OpenAI, DashScope, SiliconFlow, Ollama, or any OpenAI-compatible endpoint
- 🧪 **Typed** — Full TypeScript support
- 📦 **Zero Framework** — Only `openai` SDK as dependency

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your API key | *(required)* |
| `OPENAI_BASE_URL` | API endpoint | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model name | `gpt-4o-mini` |

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

**SiliconFlow:**
```env
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
OPENAI_MODEL=Qwen/Qwen2.5-72B-Instruct
```

**Ollama (local):**
```env
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=qwen2.5:7b
```

## Architecture

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│  User   │────▶│  Agent   │────▶│   LLM   │
│  Input  │     │  Loop    │     │  API    │
└─────────┘     └────┬─────┘     └────┬────┘
                     │                │
               ┌─────▼─────┐          │
               │   Tools   │◀─────────┘
               │ (weather) │  tool_call
               └───────────┘
```

## Project Structure

```
mini-agent/
├── src/
│   ├── agent.ts          # Core ReAct loop (exported)
│   ├── cli.ts            # Interactive CLI entry point
│   ├── index.ts          # Barrel exports
│   └── tools/
│       └── weather.ts    # Tool definitions & handlers
├── tests/
│   └── test.ts           # Integration tests
├── .env.example          # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## API Usage

```typescript
import { runAgent } from "./src/index.js";

// Simple call
const reply = await runAgent("北京天气怎么样？");
console.log(reply);

// With custom callback
const reply = await runAgent("上海天气如何？", {
  onToolCall: (name, args, result) => {
    console.log(`Tool: ${name}, Result: ${result}`);
  },
});
```

## Adding New Tools

1. Create a tool in `src/tools/`
2. Add handler to `toolHandlers`
3. Add definition to `allTools` array

See `src/tools/weather.ts` for reference.

## License

MIT
