# Slopify

Slopify is a native, local workbench for orchestrating workflows of already-configured
AI agent harnesses. A workflow is a directed graph of agents with shared local Git
projects and declared run variables. Pi is the first supported harness.

Slopify owns workflow definitions, run coordination, Git worktrees, and execution
traces. Harness installation and setup stay external to Slopify.

## Requirements

- macOS or a Linux VPS
- Bun 1.4.0
- Git
- [Pi](https://pi.dev/) installed on `PATH` and configured for the agents you want to run
- Any developer tools expected by that Pi installation

The Harnesses screen reports whether Pi is available and shows the models Pi exposes on
the current host.

## Run locally

```sh
bun install --frozen-lockfile
bun run dev
```

Turborepo starts the Hono API and Next.js application together and builds their internal
dependencies in graph order. Open <http://127.0.0.1:3000>.

To run the production builds locally:

```sh
bun run build
bun run start
```

All repository commands use Bun. Turborepo owns cross-workspace ordering, parallelism,
and caching; individual package scripts only operate on their own package.

## Local state and worktrees

Slopify stores owner-local state under `~/.slopify/orchestrator/` by default:

- `~/.slopify/orchestrator/slopify.db` contains workflows, Projects, immutable run
  snapshots, queue state, and audit events.
- `~/.slopify/orchestrator/traces/` contains per-agent JSONL transcripts.
- `~/.slopify/orchestrator/worktrees/<runId>/<projectId>/` contains one detached Git
  worktree for every Project captured by a run.

Every agent in a run starts in the configured primary Project worktree and can use all
other worktrees from that run. The original source repositories are never supplied as
agent workspaces. Slopify validates the canonical worktree paths before every agent
starts and rejects symbolic-link substitutions that could redirect execution elsewhere.

## Host access

Pi runs directly as the user who started Slopify and uses that user's existing Pi and
host configuration. Run worktrees isolate Git state and prevent accidental direct edits
to configured source checkouts. They do not restrict access to the rest of the host, so
run Slopify only with harnesses and projects you trust.

Slopify starts Pi without project-local approval and uses a small completion bridge to
capture each node result. Sensitive-looking environment values are redacted from events
and structured results, but the harness can still read other user files. Execution
traces therefore remain trusted, owner-local data.
