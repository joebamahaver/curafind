# Curafind

Clinical trial and treatment research for HackMidwest 2026. Next.js Server Functions run a fresh AWS Strands agent using `goog3` (`gemini-3.1-flash-lite`) and [Medical MCP](https://github.com/JamesANZ/medical-mcp).

## Setup

Use Node 22.18+ and Docker. Run `npm install`, copy the settings in `.env.example` into your `.env`, and set `GEMINI_API_KEY`. Keep this key on the server; do not use a `NEXT_PUBLIC_` prefix.

```sh
npm run setup:mcp
npm run test:mcp
# Optional live goog3 test; uses the API key and synthetic, unknown answers:
npm run test:mcp -- --agent
```

The container listens at `http://127.0.0.1:3100/mcp`. `npm run setup:mcp` rebuilds and recreates it after Docker source changes. Stop it with `npm run stop:mcp`. Start the frontend yourself with `npm run dev` when ready.

The previous evaluation endpoints have been replaced by `/api/research`. See [the integration guide](docs/medical-mcp.md) for examples, configuration, raw JSON access, and deployment limits.

```sh
npm test
npm run build
```
