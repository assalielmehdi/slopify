# Slopify agent guide

## Product

Slopify is a native, local workflow orchestrator for already-installed agent harnesses.
Users define directed graphs of agents, choose a harness, configure prompts, and run
them against workflow Repositories with workflow-defined variables. Pi and Codex are
supported harnesses and run through their CLIs.

## Architecture invariants

- The codebase follows hexagonal architecture. Domain and application code depend on
  ports and application-owned types; infrastructure adapters depend inward. Wire
  concrete adapters only in the API composition root.
- A workflow has one current mutable definition; Slopify has no user-facing or internal
  workflow revision model. Every run captures an immutable copy of the full workflow
  graph and each agent configuration at admission. Execution and historical inspection
  always use that run snapshot, never the current workflow. Routing outcomes come from
  the captured graph edges.
- Workflows contain only agent nodes. An empty workflow is a valid draft but is not
  runnable. Agent nodes may be graph leaves; a successful leaf completes its branch.
- Workflow configuration owns the repositories and variable names shared by all its agents.
  Every configured repository identifies a GitHub.com or GitLab.com repository and must
  resolve through its configured provider connection before run admission. One
  configured repository is primary and is the starting directory for every agent; all
  configured repositories remain available to every node.
- A run must provide exactly one JSON value for every variable name declared by its
  captured workflow. Slopify interpolates only exact `{{ variable }}` placeholders whose
  names are declared there; undeclared placeholders remain literal.
- Only the coordinator interprets workflow topology, readiness, joins, transitions, and
  terminal state. Workers and node runners are graph-neutral.
- Execution is durable and asynchronous:
  `Run API -> filesystem journal -> coordinator -> scheduled-node journal -> worker ->
node runner`. Node facts return through the run journal. Message handling is at least
  once, so handlers and attempts must remain idempotent. The event journal is
  append-only audit history, never a queue.
- Run admission captures each configured Repository's provider identity, HTTPS clone URL,
  default branch, and current default-branch commit. Before a harness process starts,
  the worker creates one fresh clone per captured Repository at
  `~/.slopify/workflows/<workflowId>/runs/<runId>/workspaces/<repositoryId>` and checks out the deterministic
  branch `slopify/<runId>` from the captured commit. Agents in one run share those clones
  and branches; separate runs never share a clone.
- Slopify never pushes a run branch or creates a pull request. Agents do so deliberately
  when their task requires it. Once a run reaches `SUCCEEDED`, `FAILED`, or `CANCELLED`,
  Slopify removes its cloned workspace by default. Durable workspace state lets startup
  polling retry cleanup after interruption.
- Each agent execution receives a fresh harness process and creates a fresh persisted
  harness session; Slopify never resumes an earlier session automatically. Pi uses CLI
  RPC and Codex uses JSONL execution with `--yolo`. The process starts in the primary
  run clone without repository-local approval and receives the provider, repository,
  workspace path, branch, and base commit in its execution contract. The adapter-owned
  result protocol is the only routable agent result: Pi uses the `slopify_complete_node`
  bridge and Codex uses a structured output schema. Terminal run projections retain a
  harness-neutral session reference and the exact command for reopening that session.
- Harnesses run directly as the Slopify host user and use the existing host-level setup.
  Harness setup is external to Slopify. Fresh Git clones isolate concurrent run state;
  they do not restrict access to other host paths.
- Harness availability and model metadata are discovered live through application
  ports. Infrastructure adapters implement those ports; workflow and execution code
  must not branch on Pi-specific protocols. Minimal agent traces record the selected
  harness, immutable cloned-workspace context, lifecycle, session reference, and final
  result without capturing the intermediate message, reasoning, skill, or tool stream.
- Before every harness launch, Slopify verifies the Git clone, origin, branch, and exact
  deterministic path under the canonical workspaces root. Symbolic-link or
  parent-directory substitutions fail the node instead of changing its workspace.
- Trace capture redacts bounded sensitive-looking values inherited from the harness
  process environment from structured node results. Since the host harness can read
  other user files, traces and resumable harness sessions are trusted owner-local data.
- The run detail client short-polls the durable run projection once per second only while
  a run is active and stops at a terminal status. Run and agent execution updates do not
  use WebSockets or server-sent events; editable-resource notifications remain a separate
  server-sent event channel.
- `~/.slopify` owns settings, non-secret Git connection metadata, Repositories,
  workflows, immutable run snapshots, projections, journals, workspaces, and owner-local
  JSONL agent traces. Harness state remains owned by the harness on the host.
- `SLOPIFY_HOME` is the only runtime state-root override. Editable JSON resources are
  validated as complete documents and may change outside the UI.

## Code map

- `src/api`: Hono HTTP adapters, domain modules, host-harness infrastructure adapters,
  and the composition root (`src/server.ts`).
- `src/web`: Next.js UI and API proxy.
- `src/shared`: shared application contracts plus strict workflow and agent graph schemas.

## Frontend

- Use Next.js, React, Tailwind CSS, and the existing ShadCN component system.
- ShadCN is configured in `src/web/components.json` with the `base-lyra` style, zinc
  base color, CSS variables, and Lucide icons.
- Root `DESIGN.md` is the canonical visual identity and design-system contract. Read it
  before changing application UI, and keep implementations consistent in light and dark
  modes.
- Always reuse components from `src/web/components/ui` before adding anything new.
  Do not create bespoke replacements or introduce another component preset/library.
- Keep server/client boundaries explicit and preserve accessible labels, keyboard
  behavior, loading, empty, and error states.

## Working rules

- Use Bun 1.4.0 for the application runtime, workspace dependency management, and
  repository scripts.
- Use Turborepo for every cross-workspace task. Root scripts delegate to Turbo, while
  package scripts act only on their own package and never build workspace dependencies
  recursively.
- Run JavaScript and TypeScript tools through Bun. Do not introduce Node, npm, npx,
  pnpm, Yarn, or another package-manager/runtime command path.
- Keep changes focused. Use strict Zod schemas and exhaustive discriminated unions;
  do not leak infrastructure types into core contracts.
- Write or update tests first for behavior changes. Core services must remain testable
  with in-memory adapters.
- Run tests, typecheck, lint, formatting, and the production build before handoff.
- Use Chrome for browser verification; do not use Playwright.
- The only documentation files allowed in the repository are root `README.md`, root
  `AGENTS.md`, and root `DESIGN.md`. Do not add specs, plans, notes, or package-level
  Markdown/text files.
