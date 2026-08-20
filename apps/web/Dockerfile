FROM oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef AS dependencies

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile

FROM dependencies AS builder

RUN mkdir -p apps/web/public && bun run --filter @loop/web build

FROM oven/bun:1.4.0-debian@sha256:5bb0f9be3a1a36a03e27c9a9dd894a3b1ad26657155c7df4dda771e17bf872ef AS runner

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=bun:bun /app/apps/web/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=bun:bun /app/apps/web/public ./apps/web/public

USER bun

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/healthz',{signal:AbortSignal.timeout(2000)}).then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["bun", "apps/web/server.js"]
