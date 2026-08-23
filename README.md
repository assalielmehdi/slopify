# Slopify

Slopify is a native local workbench for defining and running directed graphs of AI
agents. Each run captures its workflow, agent configurations, connector grants, and
optional input variables so historical execution remains inspectable and reproducible.

## Requirements

- macOS on Apple Silicon
- Bun 1.4+
- QEMU (`brew install qemu`)

## Run

```sh
bun install --frozen-lockfile
bun run build
bun run --filter @slopify/api start
```

Start the web application in another terminal:

```sh
bun run --filter @slopify/web dev
```

Open <http://127.0.0.1:3000>. Local application data is stored in `~/.slopify/`.

## Figma connector

Slopify connects to the MCP server built into Figma Desktop. No OAuth client or Figma
token is required. Before connecting:

1. Open a Figma Design file in the latest Figma desktop app.
2. Switch to Dev Mode.
3. Enable the desktop MCP server in the inspect panel.
4. Keep Figma Desktop open, then connect Figma from Slopify.

Figma Desktop serves MCP at `http://127.0.0.1:3845/mcp`. Slopify validates that exact
endpoint on the host, exposes its current tools to Pi as native `figma_*` tools, and
mediates calls and local asset URLs into each execution's Gondolin VM.
