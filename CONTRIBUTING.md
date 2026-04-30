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
npm test        # Run tests
```

## Project Structure

```
├── src/
│   ├── agent.ts          # Core ReAct loop
│   ├── cli.ts            # Interactive CLI entry
│   ├── index.ts          # Barrel exports
│   └── tools/
│       └── weather.ts    # Tool definitions & handlers
├── tests/
│   └── test.ts           # Integration tests
└── .env.example          # Environment template
```

## Adding New Tools

1. Create a new file in `src/tools/`
2. Export the tool definition (OpenAI `ChatCompletionTool` format)
3. Add the handler to `toolHandlers` in `weather.ts` (or create a registry)
4. Add the tool to `allTools` array

## Pull Requests

- Keep it focused — one feature/fix per PR
- Write clear commit messages
- Tests should pass (`npm test`)
- No secrets in `.env` files
