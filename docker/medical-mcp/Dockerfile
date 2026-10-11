FROM node:22-bookworm-slim AS build
WORKDIR /app
# npm's 1.0.8 release lacks trial search. Pin the current upstream source.
ADD https://codeload.github.com/JamesANZ/medical-mcp/tar.gz/9e98f2eb10a6830730ff8fc2228bb54f9f75c154 /tmp/medical-mcp.tar.gz
RUN tar -xzf /tmp/medical-mcp.tar.gz --strip-components=1 -C /app
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts
COPY docker/medical-mcp/trial-search.mjs /app/build/curafind-trial-search.js
COPY docker/medical-mcp/extend.mjs /tmp/extend.mjs
RUN node /tmp/extend.mjs

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
ENV HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "build/index.js", "--http"]
