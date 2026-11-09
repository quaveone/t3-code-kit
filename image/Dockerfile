# T3 Code server, run as-is. The entrypoint starts as root only to fix /data ownership, then runs as `t3`.
# Installs a pinned upstream stable release; no patches.
FROM debian:bookworm-slim

ARG T3_VERSION=0.1.8
ARG T3_SHA256_X64=
ARG T3_SHA256_ARM64=
ARG CLAUDE_CODE_VERSION=2.1.311
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client jq sqlite3 procps tini less unzip gnupg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# T3 Code: official self-contained Linux build, checked against the release SHA256SUMS.
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac; \
    base="https://github.com/pingdotgg/t3code/releases/download/v${T3_VERSION}"; \
    archive="t3-${T3_VERSION}-linux-${arch}.tar.gz"; \
    cd /tmp; \
    curl -fsSLO "${base}/${archive}"; \
    curl -fsSL "${base}/SHA256SUMS" | grep " ${archive}\$" | sha256sum -c -; \
    mkdir -p "/opt/t3/${T3_VERSION}"; \
    tar -xzf "${archive}" -C "/opt/t3/${T3_VERSION}" --strip-components=1; \
    ln -s "/opt/t3/${T3_VERSION}/t3" /usr/local/bin/t3; \
    rm -f "${archive}"; \
    t3 --version

# Claude Code: official native installer at a pinned version, copied out of the build HOME.
RUN set -eu; \
    export HOME=/tmp/claude-install; \
    curl -fsSL https://claude.ai/install.sh | bash -s "${CLAUDE_CODE_VERSION}"; \
    install -m 0755 "$(readlink -f "$HOME/.local/bin/claude")" /usr/local/bin/claude; \
    rm -rf /tmp/claude-install; \
    claude --version

# Runtime libraries for T3's built-in Chrome (Chrome itself downloads into T3CODE_HOME on first use).
# The container is the sandbox, so Chrome's own sandbox is turned off (T3CODE_SERVER_BROWSER_SANDBOX=0).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
      fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/t3 --uid 1000 --shell /bin/bash t3 \
    && mkdir -p /data && chown t3:t3 /data

COPY entrypoint.sh /usr/local/bin/t3-entrypoint
COPY as-t3 /usr/local/bin/as-t3
RUN chmod 0755 /usr/local/bin/t3-entrypoint /usr/local/bin/as-t3

ENV HOME=/data/home \
    T3CODE_HOME=/data/t3 \
    T3_PORT=3773 \
    DISABLE_AUTOUPDATER=1 \
    T3CODE_SERVER_BROWSER_SANDBOX=0 \
    CLAUDE_CODE_DISABLE_AUTOUPDATER=1
WORKDIR /data
EXPOSE 3773
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/t3-entrypoint"]
