FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
RUN mkdir -p /data && chown bun:bun /data
USER bun
ENV PORT=8787 STATE_PATH=/data/bridge.sqlite
EXPOSE 8787
CMD ["bun", "run", "src/main.ts"]
