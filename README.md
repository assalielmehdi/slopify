# Slopify

Slopify is a native, local workbench for orchestrating workflows of already-configured
AI agent harnesses. A workflow is a directed graph of agents with shared GitHub or
GitLab repositories and declared run variables. Pi and Codex are supported harnesses.

Slopify owns workflow definitions, run coordination, isolated Git clones, and execution
traces. Harness installation and setup stay external to Slopify.

## Application model

- **Settings** persist the Light, Dark, or System appearance and non-secret GitHub.com
  and GitLab.com connection metadata. Personal access tokens remain write-only and live
  in the operating system credential store.
- **Repositories** are provider repositories selected through those connections. They
  are catalog entries, not assumptions about directories already present on the host.
- **Harnesses** reflect supported coding-agent harnesses discovered live on the host.
  Slopify does not install them or own their configuration.
- **Workflows** are JSON-defined directed graphs containing agent nodes and edges. Each
  workflow selects its Repositories, one primary Repository, and the variable names a
  run must provide. The UI validates and visualizes the graph; JSON remains the editable
  source of truth.
- **Runs** start through the same local API used by the UI. Admission captures immutable
  workflow, variable, and Repository snapshots before asynchronous execution begins.
  Run history and agent panels expose execution state, prompts, reasoning, tool activity,
  results, and captured workspace context from those snapshots and append-only journals.

## Requirements

- macOS or a Linux VPS
- Bun 1.4.0
- Git
- [Pi](https://pi.dev/) and/or [Codex](https://developers.openai.com/codex/cli/)
  installed on `PATH` and configured for the agents you want to run
- Any developer tools expected by the selected harness

The Harnesses screen reports whether Pi and Codex are available and shows the models each
harness exposes on the current host.

Connect GitHub or GitLab from Settings with a personal access token before adding
Repositories. Tokens are stored in the operating system credential store, not JSON files.

## Run locally

```sh
bun install --frozen-lockfile
bun run dev
```

Turborepo starts the Hono API and Next.js application together and builds their internal
dependencies in graph order. Open <http://127.0.0.1:7310>.

To run the production builds locally:

```sh
bun run build
bun run start
```

All repository commands use Bun. Turborepo owns cross-workspace ordering, parallelism,
and caching; individual package scripts only operate on their own package.

## Local state and run workspaces

Slopify stores all owner-local configuration and data under `~/.slopify/` by default:

- `~/.slopify/settings.json` contains interface and non-secret Git connection settings.
- `~/.slopify/repositories.json` contains the Repository catalog.
- `~/.slopify/workflows/<workflowId>/workflow.json` contains each workflow definition.
- `~/.slopify/workflows/<workflowId>/runs/<runId>/` contains immutable snapshots,
  projections, append-only event journals, per-agent JSONL traces, and fresh Repository
  clones for that run.
- `~/.slopify/schemas/` contains the published JSON Schemas for settings, Repositories,
  and workflow definitions.
- `~/.slopify/runtime/` contains ephemeral single-instance ownership state.
- `~/.slopify/migrations/` contains verified legacy SQLite backups, manifests, and
  resumable conversion artifacts when an existing installation is migrated.

`SLOPIFY_HOME` overrides this one state root. Slopify does not support separate database,
trace, or workspace roots. Files may be inspected or edited directly: Slopify validates
complete resources before accepting them, watches editable resources for external
changes, and surfaces invalid or conflicting edits without silently rewriting them.

Every agent in a run starts in the configured primary Repository clone and can use every
other clone from that run. Slopify creates the deterministic branch `slopify/<runId>` in
each clone, so later agents see changes made by earlier agents. Separate runs never
share a clone. Slopify validates canonical workspace paths before every agent starts and
rejects symbolic-link substitutions that could redirect execution elsewhere.

Slopify never pushes the run branch or creates a pull request. Agents do that only when
their task requires it. After a run succeeds, fails, or is cancelled, Slopify deletes
its cloned workspaces by default and records the cleanup durably.

## Host access

Harnesses run directly as the user who started Slopify and use that user's existing host
configuration. Fresh run clones isolate Git state between concurrent runs. They do not
restrict access to the rest of the host, so run Slopify only with harnesses and
repositories you trust.

Slopify starts each node in a fresh harness process without repository-local approval.
Pi uses its RPC protocol and a small completion bridge; Codex uses ephemeral JSONL
execution and an adapter-owned structured output schema. Sensitive-looking environment
values are redacted from events and structured results, but the harness can still read
other user files. Execution traces therefore remain trusted, owner-local data.

## Legacy migration

On startup, Slopify detects the previous SQLite layout, refuses migration while legacy
runs are active or filesystem targets conflict, creates and verifies a byte-identical
backup, converts the catalog and terminal run history, and installs the filesystem
resources atomically. Installation is resumable and supports rollback while its recovery
artifacts remain intact. SQLite is never initialized for a clean installation and is
loaded only by this read-only compatibility importer.
