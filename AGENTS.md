# Slopify agent guide

## Product

Slopify is a native, local AI delivery workbench. Users define immutable workflow
graphs, configure agent jobs and their capabilities, and run them against isolated Git
worktrees. V1 implements agent jobs; code jobs are intentionally deferred.

## Architecture invariants

- The codebase follows hexagonal architecture. Domain and application code depend on
  ports and application-owned types; infrastructure adapters depend inward. Wire
  concrete adapters only in the API composition root.
- Workflow revisions are immutable and runs stay pinned to one revision. Agent jobs are
  strict definitions embedded in revisions. Routing outcomes come from graph edges.
- Only the coordinator interprets workflow topology, readiness, joins, transitions, and
  terminal state. Workers and job runners are graph-neutral.
- Execution is durable and asynchronous:
  `Run API -> coordinator -> SQLite execution_messages -> worker -> job runner`, with
  job facts returning through the same table. One table has separate `WORKER` and
  `COORDINATOR` destinations. Delivery is at least once, so handlers and attempts must
  remain idempotent. `run_events` is append-only audit history, never a queue.
- Each agent execution receives a fresh trusted Bun child process, Pi session, and
  private Gondolin VM. Agent-accessible filesystem, shell, process, and network effects
  must run inside the VM. Run worktrees are mounted read/write; pinned skill snapshots
  are mounted read-only. `complete_node` is the only routable agent result.
- Skills provide instructions, not authority. Connector grants, mounted worktrees,
  installed tools, and default-deny VM policy define authority.
- Raw credentials belong only to the owner-only Slopify credential file. Never persist
  them in SQLite or workflow JSON, expose them to browsers, prompts, events, logs, or
  worktrees, or mount them into VMs. Connector access uses execution-scoped mediated
  capabilities; inference credentials remain in the trusted worker.
- SQLite owns workflow, run, connection metadata, queue, and audit state. The live
  Skills catalog is filesystem-backed; published revisions use immutable,
  content-addressed skill snapshots.

## Code map

- `apps/api`: Hono HTTP adapters and the composition root (`src/server.ts`).
- `apps/web`: Next.js UI and API proxy.
- `packages/workflow-model`: strict workflow/job schemas, graph rules, and revisions.
- `packages/execution-runtime`: use cases, ports, coordinator, worker, persistence,
  connections, Skills, and job runners.
- `packages/agent-runtimes`: Bun child supervision, Pi SDK integration, Gondolin, and
  ChatGPT OAuth.
- `packages/contracts`: shared application contracts.
- `packages/gitlab-delivery` and `packages/clickup-artifacts`: service-specific adapters.

## Frontend

- Use Next.js, React, Tailwind CSS, and the existing ShadCN component system.
- ShadCN is configured in `apps/web/components.json` with the `base-lyra` style, zinc
  base color, CSS variables, and Lucide icons.
- Always reuse components from `apps/web/components/ui` before adding anything new.
  Do not create bespoke replacements or introduce another component preset/library.
- Keep server/client boundaries explicit and preserve accessible labels, keyboard
  behavior, loading, empty, and error states.

## Working rules

- Bun is the application runtime; use pnpm for workspace dependency management and
  repository scripts.
- Keep changes focused. Use strict Zod schemas and exhaustive discriminated unions;
  do not leak infrastructure types or raw credentials into core contracts.
- Write or update tests first for behavior changes. Core services must remain testable
  with in-memory adapters.
- Run tests, typecheck, lint, formatting, and the production build before handoff.
- Use Chrome for browser verification; do not use Playwright.
- The only documentation files allowed in the repository are root `README.md` and root
  `AGENTS.md`. Do not add specs, plans, notes, or package-level Markdown/text files.
