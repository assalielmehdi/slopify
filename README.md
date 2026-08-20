# Slopify

Slopify is a native local workbench for defining and running isolated AI delivery
workflows against Git repositories.

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
pnpm --filter @loop/api start
```

Start the web application in another terminal:

```sh
pnpm --filter @loop/web dev
```

Open <http://127.0.0.1:3000>. Local application data is stored in `~/.slopify/`.
