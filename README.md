# Slopify

Slopify is a local AI delivery workbench. Its deployable stack contains exactly
two long-running services: the Next.js web application and the Hono API with
SQLite and the embedded Pi SDK.

## Prerequisites

- Docker Engine
- Docker Compose 2.21.0 or newer
- A clone of this repository

Compose 2.21.0 is the minimum because the startup command uses both `--wait`
and `--wait-timeout`.

## Quick start

Copy the non-secret environment template, edit any required values, and start
the stack:

```sh
cp .env.example .env
docker compose up --build --wait --wait-timeout 120
```

Open <http://127.0.0.1:3000>. If you change `APP_HOST` or `APP_PORT`, use that
binding instead.

You can also export the variables in your shell and run only the `docker
compose up` command. Validate the resolved configuration before startup with:

```sh
docker compose config --quiet
```

The browser talks only to the web origin. Next.js proxies same-origin `/api`
requests and event streams to the private `api:3001` service; the API port is
not published to the host.

## Runtime data and repositories

SQLite and durable run evidence live in a Docker-managed named volume mounted
at `/var/lib/workbench`. Candidate repositories live below `/workspace` in the
API container.

By default, the committed `./workspace` directory is mounted at `/workspace`.
Place candidate repositories below it, or set `WORKSPACE_HOST_PATH` to another
existing host directory before startup. Project-profile repository paths must
use their runtime-visible `/workspace/...` paths. The app can start without a
candidate repository, but a workflow run cannot.

The base API image contains only the application and its baseline Git, glab,
OpenSSH, Bash, Node.js, Corepack, and pnpm tools. Each project profile must
declare and pass readiness checks for any additional required executable.

## Credentials and readiness

External credentials are optional for startup. With blank tokens the web and
API services become healthy, connector status remains not ready, and workflow
runs are rejected until their profile, repositories, tools, and connectors pass
readiness checks.

Set secrets only in an ignored `.env` file or exported shell variables. Never
put them in this repository, image build arguments, browser variables, or the
Compose file. ClickUp workspace IDs belong to project profiles. Pi provider,
model, and thinking-level choices belong to immutable workflow revisions rather
than global Compose overrides.

Environment variables are the default credential mechanism. A local Pi SDK
authentication file may be used only after an explicit credential-file adapter
is configured. Keep the file outside this repository and add a local
`compose.override.yaml` such as:

```yaml
services:
  api:
    volumes:
      - type: bind
        source: ${PI_CREDENTIALS_FILE_HOST_PATH:?set an absolute credential-file path}
        target: /run/secrets/pi-auth.json
        read_only: true
        bind:
          create_host_path: false
```

Set `PI_CREDENTIALS_FILE_HOST_PATH` to an existing absolute host path and point
the configured adapter at `/run/secrets/pi-auth.json`. Do not mount a home
directory, filesystem root, Docker socket, or general host authentication
directory.

## Operations

Follow service logs:

```sh
docker compose logs --follow
```

Stop and remove the containers and network while preserving durable data:

```sh
docker compose down
```

`docker compose down --volumes` permanently deletes the named SQLite and run
evidence volume. It is a destructive reset and is never part of normal
shutdown.
