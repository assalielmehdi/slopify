# Slopify agent guide

## Product

Slopify is a native, local workflow orchestrator for already-installed agent harnesses.
Users define directed graphs of agents, choose a harness, configure prompts, and run
them against workflow Projects with workflow-defined variables. Pi is the first
supported harness and runs through its CLI.

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
- Workflow configuration owns the projects and variable names shared by all its agents.
  Every configured project must resolve to an available local Git repository before run
  admission. One configured project is primary and is the starting directory for every
  agent; all configured projects remain available to every node.
- A run must provide exactly one JSON value for every variable name declared by its
  captured workflow. Slopify interpolates only exact `{{ variable }}` placeholders whose
  names are declared there; undeclared placeholders remain literal.
- Only the coordinator interprets workflow topology, readiness, joins, transitions, and
  terminal state. Workers and node runners are graph-neutral.
- Execution is durable and asynchronous:
  `Run API -> coordinator -> SQLite execution_messages -> worker -> node runner`, with
  node facts returning through the same table. One table has separate `WORKER` and
  `COORDINATOR` destinations. Message handling is at least once, so handlers and
  attempts must remain idempotent. `run_events` is append-only audit history, never a
  queue.
- Run admission captures each configured Project's canonical path, current commit, and
  source branch. Before a harness process starts, the worker prepares one detached Git
  worktree per captured Project at
  `~/.slopify/orchestrator/worktrees/<runId>/<projectId>`. Agents in one run share those
  worktrees; separate runs never share a worktree. Never give a harness the source
  checkout as its workspace.
- Each agent execution receives a fresh Pi CLI RPC process with no persisted Pi session.
  It starts in the primary run worktree without project-local approval and receives only
  run worktree paths in its Slopify prompt and execution contract. Slopify's adapter-owned
  `slopify_complete_node` bridge is the only routable agent result.
- Pi runs directly as the Slopify host user and uses the existing host-level Pi setup.
  Harness setup is external to Slopify. Git worktrees isolate configured Project state;
  they do not restrict access to other host paths.
- Harness availability and model metadata are discovered live through application
  ports. Infrastructure adapters implement those ports; workflow and execution code
  must not branch on Pi-specific protocols. Agent traces record the selected harness
  and immutable worktree context without source checkout paths.
- Before every harness launch, Slopify verifies that Git registered each run worktree at
  its exact deterministic path under the canonical worktrees root. Symbolic-link or
  parent-directory substitutions fail the node instead of changing its workspace.
- Trace capture redacts bounded sensitive-looking values inherited from the harness
  process environment and applies the same redaction to structured node results. Since
  the host harness can read other user files, traces are trusted owner-local data.
- SQLite owns current workflow, Project, run snapshot, run-worktree state, queue, and
  audit data. `run_events` is append-only audit history and agent transcripts are stored
  as owner-local JSONL traces. Harness state remains owned by the harness on the host.

## Code map

- `apps/api`: Hono HTTP adapters and the composition root (`src/server.ts`).
- `apps/web`: Next.js UI and API proxy.
- `packages/workflow-model`: strict workflow and agent schemas with graph rules.
- `packages/execution-runtime`: use cases, ports, coordinator, worker, persistence,
  worktree provisioning, harness discovery, and node runners.
- `packages/agent-runtimes`: infrastructure adapters for host harnesses; currently Pi
  CLI inspection and RPC execution.
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
