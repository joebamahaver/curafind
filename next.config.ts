import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@strands-agents/sdk", "@modelcontextprotocol/client", "openai"],
  /* config options here */
  cacheComponents: true,
  // MCP opens live SSE streams that are aborted at the end of each invocation.
  // Development's fetch cache must not clone and retain those response bodies.
  experimental: { serverComponentsHmrCache: false },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
