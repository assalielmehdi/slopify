# Slopify

Slopify is a native local workbench for defining and running directed graphs of AI
agents. Each run captures its workflow, agent configurations, connector grants, and
optional input variables so historical execution remains inspectable and reproducible.

## Requirements

- macOS on Apple Silicon
- Bun 1.4+
- Node.js 24.18.0
- pnpm 11+
- QEMU (`brew install qemu`)

## Run

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @slopify/api start
```

Start the web application in another terminal:

```sh
pnpm --filter @slopify/web dev
```

Open <http://127.0.0.1:3000>. Local application data is stored in `~/.slopify/`.
