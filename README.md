# Curafind

Clinical trial and treatment research for HackMidwest 2026. Next.js Server Functions run a fresh AWS Strands agent using Cerebras `gpt-oss-120b` and [Medical MCP](https://github.com/JamesANZ/medical-mcp).

## Setup

Use Node 22.18+ and Docker. Run `npm install`, copy the settings in `.env.example` into your `.env`, and set `CEREBRAS_API_KEY`. Keep this key on the server; do not use a `NEXT_PUBLIC_` prefix. `CEREBRAS_MODEL` defaults to `gpt-oss-120b`.

```sh
npm run setup:mcp
npm run test:mcp
# Optional live Cerebras test; uses the API key and synthetic, unknown answers:
npm run test:mcp -- --agent
```

The container listens at `http://127.0.0.1:3100/mcp`. `npm run setup:mcp` rebuilds and recreates it after Docker source changes. Stop it with `npm run stop:mcp`. Start the frontend yourself with `npm run dev` when ready.

The previous evaluation endpoints have been replaced by `/api/research`. See [the integration guide](docs/medical-mcp.md) for examples, configuration, raw JSON access, and deployment limits.

```sh
npm test
npm run build
```
