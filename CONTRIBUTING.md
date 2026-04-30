# Contributing

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/mini-agent.git
cd mini-agent

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env with your API key

# 4. Run
npm start       # Interactive CLI
npm test        # Run integration tests
npm run build   # TypeScript compile
```

## Project Structure

```
src/
├── core/
│   ├── agent.ts          # Enhanced ReAct loop
│   ├── registry.ts       # Dynamic tool registry
│   ├── monitor.ts        # Tool performance monitoring
│   └── types.ts          # Type definitions
├── tools/
│   ├── filesystem.ts     # File operation tools (8 tools)
│   ├── exec.ts           # Command execution tool
│   └── web.ts            # Web fetch + time tools
├── security/
│   └── sandbox.ts        # Path sandbox validation
├── cli.ts                # Interactive CLI entry point
└── index.ts              # Barrel exports
```

## Adding New Tools

```typescript
// 1. Create src/tools/my_tool.ts
import type { ToolDefinition } from "../core/types.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

const myTool: ToolDefinition = {
  schema: {
    type: "function",
    function: {
      name: "my_tool",
      description: "My tool description",
      parameters: { /* JSON Schema */ },
    },
  } satisfies ChatCompletionTool,
  handler: async (args, ctx) => ({
    success: true,
    content: "Result here",
  }),
  permission: "sandbox",  // or "allowlist" / "require-confirm"
  help: "Short help text",
};

export { myTool };

// 2. Register in src/cli.ts (or your own setup)
import { myTool } from "./tools/my_tool.js";
registry.register("my_tool", myTool);
```

### Tool Permissions

- **`sandbox`** — Safe operations (read, list, fetch). Default.
- **`allowlist`** — Moderate risk (command execution). Check allowed commands.
- **`require-confirm`** — Destructive (delete). Should prompt user for confirmation.

## Pull Requests

- Keep it focused — one feature/fix per PR
- Write clear commit messages
- Tests should pass (`npm test`)
- Build should pass (`npm run build`)
- No secrets in `.env` files
