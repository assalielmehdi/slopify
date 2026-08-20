FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies

ARG TARGETARCH
ARG GLAB_VERSION=1.114.0
ARG GLAB_SHA256_AMD64=00e892a80d586a1e8b8fdc035321923db99dce0caa3b0c4fd72c5337ffdb1c48
ARG GLAB_SHA256_ARM64=d34d7ddb96ce5e5f3423d7e8053cb14c36bd93984e4b96320f7e20a341b83498

ENV COREPACK_HOME=/opt/corepack

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates=20250419~deb12u1 \
    curl=7.88.1-10+deb12u15 \
    g++=4:12.2.0-3 \
    make=4.3-4.1 \
    python3=3.11.2-1+b1 \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@11.22.0 --activate

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

RUN pnpm install --frozen-lockfile --filter @loop/api...

FROM dependencies AS builder

RUN pnpm --filter @loop/api build \
  && pnpm --config.store-dir=/var/lib/workbench/pnpm/store \
    --filter @loop/api deploy --prod --legacy /prod/api

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runner

ENV API_CONTAINER_MODE=true
ENV API_HOST=0.0.0.0
ENV API_PORT=3001
ENV API_SHUTDOWN_GRACE_MS=10000
ENV COREPACK_HOME=/opt/corepack
ENV DATABASE_PATH=/var/lib/workbench/workbench.sqlite
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspace
ENV pnpm_config_store_dir=/var/lib/workbench/pnpm/store

WORKDIR /app

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash=5.2.15-2+b13 \
    ca-certificates=20250419~deb12u1 \
    git=1:2.39.5-0+deb12u3 \
    libstdc++6=12.2.0-14+deb12u1 \
    openssh-client=1:9.2p1-2+deb12u10 \
    tini=0.19.0-1+b3 \
  && rm -rf /var/lib/apt/lists/* \
  && install --directory --owner=node --group=node /var/lib/workbench /workspace

ENV GLAB_CHECK_UPDATE=false
ENV GLAB_CONFIG_DIR=/var/lib/workbench/glab
ENV GLAB_SEND_TELEMETRY=false
ENV GLAB_SHOW_WHATS_NEW=false

COPY --from=dependencies /opt/corepack /opt/corepack
COPY --from=dependencies /usr/local/bin/glab /usr/local/bin/glab
COPY --from=builder --chown=node:node /prod/api ./

RUN corepack enable \
  && chmod --recursive a+rX /opt/corepack

USER node

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz',{signal:AbortSignal.timeout(2000)}).then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/server.js"]
