FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY entrypoint.sh /usr/local/bin/bridge-entrypoint
RUN chmod 0755 /usr/local/bin/bridge-entrypoint && mkdir -p /data
ENV PORT=8787 STATE_PATH=/data/bridge.sqlite
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/bridge-entrypoint"]
CMD ["bun", "run", "src/main.ts"]
