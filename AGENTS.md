# Slopify agent guide

## Product

Slopify is a native, local agent orchestration workbench. Users define directed graphs
of agents, configure their prompts and capabilities, and run them with optional
variables. V1 exposes only agent jobs. Code-job schemas and APIs remain reserved for
future compatibility, but code jobs are not executable or visible in the UI.

## Architecture invariants

- The codebase follows hexagonal architecture. Domain and application code depend on
  ports and application-owned types; infrastructure adapters depend inward. Wire
  concrete adapters only in the API composition root.
- A workflow has one current mutable definition; Slopify has no user-facing or internal
  workflow revision model. Every run captures an immutable copy of the full workflow
  graph and each job configuration at admission. Execution and historical inspection
  always use that run snapshot, never the current workflow. Routing outcomes come from
  the captured graph edges.
- Workflows may contain zero or more agent nodes. An empty workflow is a valid draft but
  is not runnable. Agent nodes may be graph leaves; Slopify does not add synthetic
  setup, start, finalization, or terminal nodes. A successful leaf completes its branch.
- Run variables are arbitrary JSON values captured with the run. Slopify interpolates
  exact `{{ variable }}` placeholders in captured agent prompts before invoking Pi. If
  referenced variables are missing, admission requires explicit confirmation and the
  missing names remain part of the run's immutable evidence.
- Only the coordinator interprets workflow topology, readiness, joins, transitions, and
  terminal state. Workers and job runners are graph-neutral.
- Execution is durable and asynchronous:
  `Run API -> coordinator -> SQLite execution_messages -> worker -> job runner`, with
  job facts returning through the same table. One table has separate `WORKER` and
  `COORDINATOR` destinations. Delivery is at least once, so handlers and attempts must
  remain idempotent. `run_events` is append-only audit history, never a queue.
- Each agent execution receives a fresh trusted Bun child process, Pi session, and
  private Gondolin VM. Agent-accessible filesystem, shell, process, and network effects
  must run inside the VM. The default workspace is an empty in-memory filesystem;
  pinned skill snapshots are mounted read-only. `complete_node` is the only routable
  agent result.
- Skills provide instructions, not authority. Connector grants, installed tools, and
  default-deny VM policy define authority. GitLab and ClickUp are generic connector
  capabilities; Slopify has no built-in task-loading or delivery/finalization path.
- Raw credentials belong only to the owner-only Slopify credential file. Never persist
  them in SQLite or workflow JSON, expose them to browsers, prompts, events, logs, or
  worktrees, or mount them into VMs. Connector access uses execution-scoped mediated
  capabilities; inference credentials remain in the trusted worker.
- SQLite owns workflow, run, connection metadata, the supported connection catalog,
  queue, and audit state. The API is the browser's only source for provider and
  connector catalog data; the frontend must not hardcode a parallel catalog. The live
  Skills catalog is filesystem-backed; run-captured workflows reference immutable,
  content-addressed skill snapshots.

## Code map

- `apps/api`: Hono HTTP adapters and the composition root (`src/server.ts`).
- `apps/web`: Next.js UI and API proxy.
- `packages/workflow-model`: strict workflow/job schemas and graph rules.
- `packages/execution-runtime`: use cases, ports, coordinator, worker, persistence,
  connections, Skills, and job runners.
- `packages/agent-runtimes`: Bun child supervision, Pi SDK integration, Gondolin, and
  ChatGPT OAuth.
- `packages/contracts`: shared application contracts.

## Frontend

- Use Next.js, React, Tailwind CSS, and the existing ShadCN component system.
- ShadCN is configured in `apps/web/components.json` with the `base-lyra` style, zinc
  base color, CSS variables, and Lucide icons.
- Root `DESIGN.md` is the canonical visual identity and design-system contract. Read it
  before changing application UI, and keep implementations consistent in light and dark
  modes.
- Always reuse components from `apps/web/components/ui` before adding anything new.
  Do not create bespoke replacements or introduce another component preset/library.
- Keep server/client boundaries explicit and preserve accessible labels, keyboard
  behavior, loading, empty, and error states.

## Working rules

- Use Bun 1.4.0 for the application runtime, workspace dependency management, and
  repository scripts.
- Keep changes focused. Use strict Zod schemas and exhaustive discriminated unions;
  do not leak infrastructure types or raw credentials into core contracts.
- Write or update tests first for behavior changes. Core services must remain testable
  with in-memory adapters.
- Run tests, typecheck, lint, formatting, and the production build before handoff.
- Use Chrome for browser verification; do not use Playwright.
- The only documentation files allowed in the repository are root `README.md`, root
  `AGENTS.md`, and root `DESIGN.md`. Do not add specs, plans, notes, or package-level
  Markdown/text files.
