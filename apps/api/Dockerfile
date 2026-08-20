FROM oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef AS dependencies

ARG TARGETARCH
ARG GLAB_VERSION=1.114.0
ARG GLAB_SHA256_AMD64=00e892a80d586a1e8b8fdc035321923db99dce0caa3b0c4fd72c5337ffdb1c48
ARG GLAB_SHA256_ARM64=d34d7ddb96ce5e5f3423d7e8053cb14c36bd93984e4b96320f7e20a341b83498

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) glab_checksum="$GLAB_SHA256_AMD64" ;; \
      arm64) glab_checksum="$GLAB_SHA256_ARM64" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
  && glab_archive="glab_${GLAB_VERSION}_linux_${TARGETARCH}.tar.gz" \
  && curl --fail --location --silent --show-error \
    "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/${glab_archive}" \
    --output "/tmp/${glab_archive}" \
  && printf '%s  %s\n' "$glab_checksum" "/tmp/${glab_archive}" | sha256sum --check --strict \
  && tar --extract --gzip --file "/tmp/${glab_archive}" \
    --directory /usr/local/bin --strip-components=1 bin/glab \
  && rm "/tmp/${glab_archive}"

COPY . .

RUN bun install --frozen-lockfile

FROM dependencies AS builder

RUN bun run --filter @loop/api build

FROM oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef AS runner

ENV API_CONTAINER_MODE=true
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
ENV API_SHUTDOWN_GRACE_MS=10000
ENV DATABASE_PATH=/var/lib/workbench/workbench.sqlite
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    ca-certificates \
    git \
    libstdc++6 \
    openssh-client \
    tini \
  && rm -rf /var/lib/apt/lists/* \
  && install --directory --owner=bun --group=bun /var/lib/workbench /workspace

ENV GLAB_CHECK_UPDATE=false
ENV GLAB_CONFIG_DIR=/var/lib/workbench/glab
ENV GLAB_SEND_TELEMETRY=false
ENV GLAB_SHOW_WHATS_NEW=false

COPY --from=dependencies /usr/local/bin/glab /usr/local/bin/glab
COPY --from=builder --chown=bun:bun /app ./

USER bun

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3001/healthz',{signal:AbortSignal.timeout(2000)}).then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["bun", "apps/api/dist/server.js"]
