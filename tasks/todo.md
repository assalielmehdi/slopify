# Task Ledger: Local AI Delivery Workbench V1

This checklist is the implementation task-list target for
[`tasks/plan.md`](./plan.md). Do not start Task 1 until the mapped specification
set and plan are accepted by a human. Decisions tied to later tasks remain
explicit dependencies and must be resolved before those tasks start.

## Task 1: Resolve and pin the supported toolchain and dependencies

**Description:** Resolve the current active-LTS Node.js release, exact pnpm
release, mutually compatible stable direct dependencies, lockstep Pi packages,
container bases, and proposed graph renderer/layout. Use Context7 for current
library/framework/SDK/API/CLI contracts and primary official sources for
release compatibility, then pin the approved results without prerelease or
floating versions.

**Acceptance criteria:**
- [x] `packageManager`, Node engine/toolchain, and every direct dependency use approved exact versions.
- [x] Pi packages are mutually compatible and pinned in lockstep; no global Pi executable is introduced.
- [x] The graph renderer/layout choice and any new dependency outside the specs have explicit human approval.

**Verification:**
- [x] Tests pass: exact pnpm 11.22.0 completes `install --frozen-lockfile` locally and under pinned Node 24.18.0.
- [x] Build succeeds: `corepack pnpm --version` is 11.22.0 in the pinned Node image and matches the root field.
- [x] Manual check: manifests, lockfile, and the dependency baseline contain exact stable selections without ranges or floating `latest` values.

**Dependencies:** Approved specs and plan; permission to research and propose the exact dependency set

**Files likely touched:**
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.node-version`
- `.npmrc`

**Estimated scope:** Medium: 3-5 files

## Task 2: Establish workspace-wide verification contracts

**Description:** Add the minimum shared TypeScript, Vitest, lint, formatting,
and root-script configuration needed for all packages and applications to use
the normative pnpm commands consistently.

**Acceptance criteria:**
- [x] Root scripts expose `build`, `typecheck`, `lint`, `test`, `test:e2e`, and `format:check` through pnpm only.
- [x] Shared configuration is strict, framework-neutral where possible, and consumable by future workspace packages.
- [x] A clean no-op workspace invocation fails on configuration errors rather than silently skipping them.

**Verification:**
- [x] Tests pass: `pnpm test` exits cleanly with the configured no-tests bootstrap behavior.
- [x] Build succeeds: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` pass under pinned Node/pnpm.
- [x] Manual check: no npm, yarn, monorepo framework, or duplicate package-level policy was introduced.

**Dependencies:** Task 1

**Files likely touched:**
- `package.json`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `prettier.config.mjs`
- `vitest.config.ts`

**Estimated scope:** Medium: 3-5 files

## Task 3: Define shared cross-module contracts

**Description:** Create `@loop/contracts` with branded identifiers and the
shared Zod contracts for API errors, artifact types, repository references,
run events, and provider-neutral evidence used across module boundaries.

**Acceptance criteria:**
- [x] Public TypeScript types are inferred from or checked by Zod schemas at trust boundaries.
- [x] Identifiers for workflow, revision, run, node, artifact, profile, and repository cannot be mixed accidentally.
- [x] Contract fixtures reject malformed identifiers, events, evidence, and secret-bearing public fields.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/contracts test` executes all 26 contract tests.
- [x] Build succeeds: package and root build, typecheck, lint, test, and format gates pass under pinned Node/pnpm.
- [x] Manual check: the built public export imports no application framework or provider adapter.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/contracts/package.json`
- `packages/contracts/tsconfig.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/schemas.ts`
- `packages/contracts/tests/schemas.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint A: After Tasks 1-3

- [x] `pnpm install --frozen-lockfile` succeeds from a clean checkout.
- [x] Root verification commands execute using the exact pinned toolchain.
- [x] Shared contracts build without importing an app or provider adapter.
- [x] Human-approved plan plus Task 1 research establish the dependency and graph-renderer baseline.

## Task 4: Model workflow nodes, edges, and revisions

**Description:** Create `@loop/workflow-model` schemas and inferred types for
workflow definitions, immutable revisions, all four node variants, finite
outcomes, labeled edges, and the global transition bound.

**Acceptance criteria:**
- [x] Agent, command, router, and terminal variants parse through an exhaustive discriminated union.
- [x] Node IDs and outcome names enforce kebab-case and every variant requires its declared fields.
- [x] Valid and invalid public fixtures act as compatibility contracts, including deeply frozen parsed revisions.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/workflow-model test -- schemas` executes all 25 workflow-schema tests.
- [x] Build succeeds: focused and root build, typecheck, lint, test, and format gates pass from a clean copy under pinned Node/pnpm.
- [x] Manual check: the built public schema parses a frozen revision and source inspection confirms no configurable agent-harness or secret field.

**Dependencies:** Task 3

**Files likely touched:**
- `packages/workflow-model/package.json`
- `packages/workflow-model/tsconfig.json`
- `packages/workflow-model/src/schemas.ts`
- `packages/workflow-model/src/types.ts`
- `packages/workflow-model/tests/schemas.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 5: Validate workflow topology and provide graph queries

**Description:** Implement pure validation and inspection helpers for starts,
terminals, registrations, reachability, outcome-to-edge cardinality, cycles,
and display-ready incoming/outgoing graph relationships.

**Acceptance criteria:**
- [x] Every enumerated invalid graph condition returns stable field-addressable findings.
- [x] Valid cyclic graphs are accepted without attempting to prove termination.
- [x] Every non-terminal outcome resolves to exactly one legal edge and every node has frozen display-ready relationships.

**Verification:**
- [x] Tests pass: the focused command executes all 45 workflow-model schema, validation, and graph-query tests.
- [x] Build succeeds: package build/typecheck plus root test, lint, and format gates pass from a clean copy under pinned Node/pnpm.
- [x] Manual check: fixtures explicitly cover duplicate/malformed/missing IDs, start ambiguity, dangling/illegal edges, reachability, registrations, transition bounds, cycles, and missing/ambiguous outcomes.

**Dependencies:** Task 4

**Files likely touched:**
- `packages/workflow-model/src/validate-workflow.ts`
- `packages/workflow-model/src/graph-queries.ts`
- `packages/workflow-model/tests/validate-workflow.test.ts`
- `packages/workflow-model/tests/graph-queries.test.ts`
- `packages/workflow-model/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Task 6: Ship the immutable predefined V1 graph

**Description:** Encode the approved delivery topology, node policies,
registered command references, transition limit, and revision-derivation rules
as source-controlled workflow data that both runtime and UI can consume.

**Acceptance criteria:**
- [x] The predefined graph matches every node, outcome, edge, workspace policy, and permission invariant in the workflow-model spec.
- [x] Editing every legally configurable agent field produces a distinct frozen revision while the parent remains byte-for-byte unchanged; invariant-locked policy changes fail visibly.
- [x] The approved transition limit permits two review/fix cycles in 23 transitions and rejects override fields.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/workflow-model test` executes all 68 package tests.
- [x] Build succeeds: package and root build, typecheck, lint, test, and format gates pass from a clean copy under pinned Node/pnpm.
- [x] Manual check: the built graph has the specified 14 nodes, 21 edges, transition limit 24, valid derivation, and unchanged parent revision.

**Dependencies:** Task 5; approved transition limit

**Files likely touched:**
- `packages/workflow-model/src/predefined-v1.ts`
- `packages/workflow-model/src/revisions.ts`
- `packages/workflow-model/tests/predefined-v1.test.ts`
- `packages/workflow-model/tests/revisions.test.ts`
- `packages/workflow-model/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint B: After Tasks 4-6

- [x] All workflow-model tests, build, typecheck, and lint checks pass.
- [x] Every validation rule has an explicit failing fixture.
- [x] The predefined cyclic graph and immutable revision behavior are inspectable.
- [x] Human confirms the encoded topology before runtime work starts.

## Task 7: Initialize the SQLite schema and connection boundary

**Description:** Create the execution-runtime package's configurable SQLite
connection, forward-only migrations, foreign-key enforcement, WAL setup, and
tables for all durable workflow, run, profile, event, artifact, workspace, and
delivery records.

**Acceptance criteria:**
- [x] A new database migrates transactionally to the expected schema with foreign keys and WAL enabled.
- [x] The configured database path is created/opened explicitly and writability failures are structured.
- [x] The schema can represent immutable revisions/snapshots and ordered multi-repository evidence without storing credentials.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- database migrations` executes all 10 persistence tests.
- [x] Build succeeds: package and root build, typecheck, lint, test, and format gates pass under pinned Node/pnpm.
- [x] Manual check: 15 application tables expose 31 foreign keys, required run/order indexes, and no secret-bearing columns.

**Dependencies:** Tasks 3 and 6; database schema approval

**Files likely touched:**
- `packages/execution-runtime/package.json`
- `packages/execution-runtime/tsconfig.json`
- `packages/execution-runtime/src/persistence/database.ts`
- `packages/execution-runtime/src/persistence/migrations.ts`
- `packages/execution-runtime/tests/persistence/database.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 8: Persist atomic lifecycle changes and ordered events

**Description:** Implement repositories that atomically store run/node state
changes with monotonically sequenced events, output chunks, artifacts, exact
configuration snapshots, repository selections, and partial delivery evidence.

**Acceptance criteria:**
- [x] State and its observable event commit in one transaction or neither commits.
- [x] Event sequence is strictly increasing per run and survives pagination/reopen.
- [x] Snapshots and partial multi-repository evidence preserve canonical profile order.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- repositories events` executes all 20 persistence tests.
- [x] Build succeeds: package and root build, typecheck, lint, test, and format gates pass under pinned Node/pnpm.
- [x] Manual check: an injected event trigger failure rolls the run status back and leaves only the prior event.

**Dependencies:** Task 7

**Files likely touched:**
- `packages/execution-runtime/src/persistence/run-repository.ts`
- `packages/execution-runtime/src/persistence/workflow-repository.ts`
- `packages/execution-runtime/src/persistence/profile-repository.ts`
- `packages/execution-runtime/src/events/event-store.ts`
- `packages/execution-runtime/tests/persistence/repositories.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 9: Execute and route one graph node at a time

**Description:** Implement the deterministic run loop, executor registry,
validated result handling, edge selection, terminal handling, and maximum-
transition enforcement without provider-specific logic.

**Acceptance criteria:**
- [x] The engine activates only the legal next node after persisting the validated result and selected edge.
- [x] Unknown, missing, ambiguous, malformed, timed-out, or executor-failed results stop visibly rather than becoming business outcomes.
- [x] Terminal, blocked, and transition-limit paths produce truthful run and node states.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- engine routing` executes all 72 runtime tests.
- [x] Build succeeds: package and root build, typecheck, lint, test, and format gates pass under pinned Node/pnpm.
- [x] Manual check: the clean trace selects one edge before terminal completion; the cycle persists exactly two edges before the transition-limit failure.

**Dependencies:** Tasks 6 and 8

**Files likely touched:**
- `packages/execution-runtime/src/engine/run-engine.ts`
- `packages/execution-runtime/src/engine/state-machine.ts`
- `packages/execution-runtime/src/executors/registry.ts`
- `packages/execution-runtime/tests/engine/run-engine.test.ts`
- `packages/execution-runtime/tests/engine/routing.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint C1: After Tasks 7-9

- [x] SQLite migration, transaction, event-ordering, and restart-open tests pass.
- [x] A provider-free fake graph reaches success, failure, and transition-limit terminal states.
- [x] No executor can bypass graph routing or persist an undeclared outcome.

## Task 10: Run bounded deterministic child processes truthfully

**Description:** Add the registered argument-array process runner with separate
stdout/stderr capture, timeouts, sanitized evidence, process-group termination,
and cancellation confirmation for trusted verification/Git operations.

**Acceptance criteria:**
- [x] Processes run without TTY or interpolated shell strings and record bounded sanitized output.
- [x] Timeout/cancel terminates the process group and reports success only after confirmed exit.
- [x] Commands are selected from application/operator configuration and never from ClickUp content.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- processes command-executor`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime typecheck && pnpm --filter @loop/execution-runtime lint`
- [x] Manual check: use a fake executable that spawns a child and confirm cancellation leaves no live process.

**Dependencies:** Task 9

**Files likely touched:**
- `packages/execution-runtime/src/processes/process-runner.ts`
- `packages/execution-runtime/src/processes/process-group.ts`
- `packages/execution-runtime/src/executors/command-executor.ts`
- `packages/execution-runtime/tests/processes/process-runner.test.ts`
- `packages/execution-runtime/tests/executors/command-executor.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 11: Compose the Hono API and health boundary

**Description:** Create the API application/server entrypoints, shared Zod
request/response and `ApiError` handling, configurable bind address/port, and
the SQLite-writability `/healthz` contract.

**Acceptance criteria:**
- [x] Hono returns the one documented error envelope for validation, domain, and unexpected failures.
- [x] `/healthz` is healthy only when the process serves and SQLite is open/writable, independent of external credentials.
- [x] The server binds configurably and uses `0.0.0.0` in container mode without exposing secrets.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/api test -- health errors`
- [x] Build succeeds: `pnpm --filter @loop/api build && pnpm --filter @loop/api typecheck`
- [x] Manual check: make the configured data path unwritable and confirm health fails without credential details.

**Dependencies:** Tasks 3 and 7

**Files likely touched:**
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/tests/health.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 12: Manage project profiles and repository readiness

**Description:** Add immutable profile snapshots, ordered candidate catalogs,
validated native/Compose paths, Git/tool/version checks, connector readiness,
and CRUD/readiness endpoints without performing task-sourced work.

**Acceptance criteria:**
- [x] Profiles reject empty/duplicate catalogs and preserve stable repository order and IDs.
- [x] Readiness returns repository-addressable filesystem, Git, tool, ClickUp, GitLab, and model-provider findings without secret values.
- [x] Compose-mode paths outside `/workspace` and unbounded/interpolated checks are rejected.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- project-profile readiness && pnpm --filter @loop/api test -- profiles connectors`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/api build`
- [x] Manual check: exercise missing path, wrong remote, missing executable, incompatible version, and absent credential fixtures.

**Dependencies:** Tasks 8, 10, and 11

**Files likely touched:**
- `packages/execution-runtime/src/services/project-profile-service.ts`
- `packages/execution-runtime/src/services/readiness-service.ts`
- `packages/execution-runtime/tests/services/readiness-service.test.ts`
- `apps/api/src/routes/project-profiles.ts`
- `apps/api/tests/project-profiles.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint C2: After Tasks 10-12

- [x] Process timeout/cancel and descendant cleanup tests pass.
- [x] API health remains distinct from connector/profile readiness.
- [x] Profile ordering, snapshots, path boundaries, and required-tool findings are proven.

## Task 13: Expose run creation, inspection, pagination, and SSE

**Description:** Implement workflow/revision/run endpoints, one-active-run
conflict handling, newest-first pagination, exact run detail, source lookup,
and persisted-then-live SSE delivery with disconnect cleanup.

**Acceptance criteria:**
- [x] Run creation validates workflow/profile readiness, snapshots inputs, and returns 409 without changing an active run.
- [x] Run lists/details reproduce exact revisions, snapshots, timings, path, evidence, and errors.
- [x] SSE replays ordered persisted events, continues live without gaps in-process, and closes on terminal/disconnect.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/api test -- workflows runs events`
- [x] Build succeeds: `pnpm --filter @loop/api build && pnpm --filter @loop/api lint`
- [x] Manual check: reconnect after a known sequence and confirm ordered replay plus prompt socket cleanup.

**Dependencies:** Tasks 9, 11, and 12

**Files likely touched:**
- `apps/api/src/routes/workflows.ts`
- `apps/api/src/routes/runs.ts`
- `apps/api/src/routes/run-events.ts`
- `packages/execution-runtime/src/services/run-service.ts`
- `apps/api/tests/runs.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 14: Implement cancellation, graceful shutdown, and restart interruption

**Description:** Coordinate cancellation of the active executor, truthful
terminal states, startup reconciliation of Running runs to Interrupted, and
bounded SIGTERM/SIGINT shutdown that stops new runs and flushes SQLite.

**Acceptance criteria:**
- [x] Cancel affects only the active cancellable run and reports Cancelled only after executor confirmation.
- [x] Unconfirmed cancellation fails explicitly; process restart exposes prior events and changes Running to Interrupted without resume.
- [x] Shutdown stops admissions, requests active cancellation, flushes state, and exits within the configured grace period.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- cancellation restart && pnpm --filter @loop/api test -- cancel shutdown`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/api build`
- [x] Manual check: terminate a fake active run and inspect the post-restart state/event history.

**Dependencies:** Tasks 10 and 13

**Files likely touched:**
- `packages/execution-runtime/src/services/cancellation-service.ts`
- `packages/execution-runtime/src/services/recovery-service.ts`
- `packages/execution-runtime/tests/services/cancellation.test.ts`
- `apps/api/src/shutdown.ts`
- `apps/api/tests/shutdown.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint C3: After Tasks 13-14

- [x] Every required runtime/API endpoint has success, validation, and status-code contracts.
- [x] One-active-run, SSE replay/live order, cancellation, shutdown, and interruption tests pass.
- [x] A fake graph remains fully inspectable after success, failure, cancel, and restart.

## Task 15: Resolve canonical ClickUp task snapshots

**Description:** Create the ClickUp adapter's bounded native-fetch client, task
ID/URL normalization, private response schemas, pagination/error mapping, and
read-only API operation that returns the immutable task snapshot used to
confirm and start a run.

**Acceptance criteria:**
- [x] A supported ID and URL resolve to the same validated canonical task identity and resource links.
- [x] Authentication, timeout, missing task, pagination, and malformed responses map to stable sanitized errors.
- [x] Task descriptions/comments remain untrusted text and are never interpreted as executable commands.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/clickup-artifacts test -- task-reference client`
- [x] Build succeeds: `pnpm --filter @loop/clickup-artifacts build && pnpm --filter @loop/clickup-artifacts typecheck`
- [x] Manual check: run fixture responses containing shell-like content and confirm they remain inert strings.

**Dependencies:** Tasks 3 and 11

**Files likely touched:**
- `packages/clickup-artifacts/package.json`
- `packages/clickup-artifacts/src/client.ts`
- `packages/clickup-artifacts/src/schemas.ts`
- `packages/clickup-artifacts/src/task-reference.ts`
- `packages/clickup-artifacts/tests/task-reference.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 16: Publish and retrieve exact ClickUp artifacts

**Description:** Implement strict envelope rendering/parsing, supported artifact
and producer/status validation, redaction/size limits, publication readback,
and exact task/run/type retrieval that rejects missing or duplicate matches.

**Acceptance criteria:**
- [x] All four artifact types round-trip through the documented visible envelope with exact identity.
- [x] Publication enforces one comment per type/run, approved producer/status values, redaction, and provider readback.
- [x] Retrieval never uses newest-comment ordering or fuzzy prose and fails explicitly on zero/multiple matches.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/clickup-artifacts test -- artifact-envelope artifact-service`
- [x] Build succeeds: `pnpm --filter @loop/clickup-artifacts typecheck && pnpm --filter @loop/clickup-artifacts lint`
- [x] Manual check: inspect Markdown/whitespace, unrelated-run, duplicate, oversize, and secret fixtures.

**Dependencies:** Task 15

**Files likely touched:**
- `packages/clickup-artifacts/src/artifact-envelope.ts`
- `packages/clickup-artifacts/src/artifact-service.ts`
- `packages/clickup-artifacts/src/redaction.ts`
- `packages/clickup-artifacts/tests/artifact-envelope.test.ts`
- `packages/clickup-artifacts/tests/artifact-service.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 17: Preserve review-summary identity and guard status transitions

**Description:** Add the single-comment review lifecycle and typed In Review
operation, preserving prior findings and requiring provider readback while
leaving finalization authorization to gitlab-delivery.

**Acceptance criteria:**
- [x] First review publishes once; later passes update the exact comment ID and preserve findings/history.
- [x] Only documented `changes-requested`, `resolved`, and `completed` transitions are accepted and read back.
- [x] The ClickUp adapter exposes status movement but cannot independently prove or claim finalization eligibility.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/clickup-artifacts test -- review-summary status-transition`
- [x] Build succeeds: `pnpm --filter @loop/clickup-artifacts build && pnpm --filter @loop/clickup-artifacts lint`
- [x] Manual check: attempt to update another run/comment and confirm no remote mutation is issued.

**Dependencies:** Task 16

**Files likely touched:**
- `packages/clickup-artifacts/src/review-summary.ts`
- `packages/clickup-artifacts/src/status-transition.ts`
- `packages/clickup-artifacts/src/index.ts`
- `packages/clickup-artifacts/tests/review-summary.test.ts`
- `packages/clickup-artifacts/tests/status-transition.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint D1: After Tasks 15-17

- [x] Fake ClickUp tests cover task resolution, timeouts, malformed responses, pagination, publication, update, and status readback.
- [x] Exact artifact identity and one-comment review lifecycle are proven.
- [x] No automated check uses or mutates a real ClickUp task.

## Task 18: Define Pi execution contracts and tool profiles

**Description:** Create `@loop/agent-runtimes` with application-owned executor
input/event/result contracts and the exact read-only/workspace-write Pi tool
allowlists, keeping SDK types private to the adapter.

**Acceptance criteria:**
- [x] Each input names one run/node, explicit workspace map, provider/model/thinking, resource bundle, timeout, permissions, and declared outcomes.
- [x] Read-only exposes only `read`, `grep`, `find`, `ls`, and completion; write adds only the approved mutation tools.
- [x] Workflow/task/prompt data cannot add tools, repositories, or a second harness.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/agent-runtimes test -- contract tool-profiles`
- [x] Build succeeds: `pnpm --filter @loop/agent-runtimes build && pnpm --filter @loop/agent-runtimes typecheck`
- [x] Manual check: compare allowlists and public types to `SPEC-agent-runtimes.md`.

**Dependencies:** Tasks 1 and 3

**Files likely touched:**
- `packages/agent-runtimes/package.json`
- `packages/agent-runtimes/tsconfig.json`
- `packages/agent-runtimes/src/contract.ts`
- `packages/agent-runtimes/src/tool-profiles.ts`
- `packages/agent-runtimes/tests/tool-profiles.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 19: Enforce typed single-call agent completion

**Description:** Implement the application-owned TypeBox `complete_node` tool
with outcome/output-schema validation, content limits, result capture, and the
exactly-once/missing/late-call failure rules.

**Acceptance criteria:**
- [x] Only one validated completion-tool call can produce a routable result.
- [x] Undeclared outcomes, malformed node data, repeated/missing/late calls, and oversized content fail the node.
- [x] Free-form assistant text and tool output never become a routing result.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/agent-runtimes test -- completion-tool`
- [x] Build succeeds: `pnpm --filter @loop/agent-runtimes typecheck && pnpm --filter @loop/agent-runtimes lint`
- [x] Manual check: exercise each failure rule with a fake tool invocation transcript.

**Dependencies:** Task 18

**Files likely touched:**
- `packages/agent-runtimes/src/completion-tool.ts`
- `packages/agent-runtimes/src/output-schemas.ts`
- `packages/agent-runtimes/tests/completion-tool.test.ts`
- `packages/agent-runtimes/src/index.ts`

**Estimated scope:** Small: 1-2 primary implementation files plus tests

## Task 20: Render bounded prompts and owned resource bundles

**Description:** Construct deterministic prompts and application-versioned
resources from the exact task/artifact/repository/diff/verification references,
while excluding user-global Pi resources and repositories outside the active
candidate or selected map.

**Acceptance criteria:**
- [x] Repository selection sees every candidate read-only; later nodes see only immutable selected worktrees in profile order.
- [x] Review prompts include deterministic base-to-HEAD changes and latest evidence grouped by repository.
- [x] Template revision, rendered prompt, resources, stop conditions, and completion contract are inspectable without hidden transcript injection.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/agent-runtimes test -- resource-loader prompt-renderer`
- [x] Build succeeds: `pnpm --filter @loop/agent-runtimes build && pnpm --filter @loop/agent-runtimes lint`
- [x] Manual check: place fake global Pi files outside the bundle and confirm they are not loaded.

**Dependencies:** Tasks 18 and 19

**Files likely touched:**
- `packages/agent-runtimes/src/resource-loader.ts`
- `packages/agent-runtimes/src/prompt-renderer.ts`
- `packages/agent-runtimes/tests/resource-loader.test.ts`
- `packages/agent-runtimes/tests/prompt-renderer.test.ts`
- `packages/agent-runtimes/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint D2: After Tasks 18-20

- [x] Pi application contracts expose no raw SDK type or selectable harness.
- [x] Completion is the only routing boundary and every invalid-call case is tested.
- [x] Prompt/resource fixtures prove candidate-versus-selected workspace isolation.

## Task 21: Construct and terminate fresh Pi SDK sessions

**Description:** Implement credential-scoped `ModelRuntime`, in-memory settings
and session creation, explicit SDK options/tools/resources, automatic-retry
disablement, execution timeout, abort/idle confirmation, and disposal for one
fresh session per node.

**Acceptance criteria:**
- [x] Every execution creates a fresh in-memory session with approved provider/model/thinking and no global/session-file state.
- [x] Cancel/timeout aborts, propagates cancellation to active tools, waits for idle, disposes, and fails if stop cannot be confirmed.
- [x] Credentials are read only from approved runtime sources and only the selected provider receives them.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/agent-runtimes test -- session-factory pi-sdk-executor model-runtime`
- [x] Build succeeds: `pnpm --filter @loop/agent-runtimes build && pnpm --filter @loop/agent-runtimes typecheck`
- [x] Manual check: confirm tests need neither a Pi CLI nor real provider credentials and leave no session alive.

**Dependencies:** Tasks 18-20; approved Pi defaults and compaction policy

**Files likely touched:**
- `packages/agent-runtimes/src/model-runtime.ts`
- `packages/agent-runtimes/src/session-factory.ts`
- `packages/agent-runtimes/src/pi-sdk-executor.ts`
- `packages/agent-runtimes/tests/session-factory.test.ts`
- `packages/agent-runtimes/tests/pi-sdk-executor.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 22: Normalize and redact observable Pi events

**Description:** Map the subscribed Pi lifecycle/message/tool/result events to
the application event union, preserve visible evidence and session identity,
discard thinking deltas, redact credentials, and dispose subscriptions on all
termination paths.

**Acceptance criteria:**
- [x] Representative SDK events map exhaustively and in order to the documented normalized event types.
- [x] Hidden reasoning and configured credential values never reach raw storage, normalized events, logs, or browser payloads.
- [x] Failure, result, cancel, and disposal paths emit one truthful terminal event and release the subscription.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/agent-runtimes test -- event-normalizer redaction pi-sdk-executor`
- [x] Build succeeds: `pnpm --filter @loop/agent-runtimes typecheck && pnpm --filter @loop/agent-runtimes lint`
- [x] Manual check: seed credential-like values across message/tool/error fixtures and inspect all emitted payloads.

**Dependencies:** Task 21

**Files likely touched:**
- `packages/agent-runtimes/src/event-normalizer.ts`
- `packages/agent-runtimes/src/redaction.ts`
- `packages/agent-runtimes/tests/event-normalizer.test.ts`
- `packages/agent-runtimes/tests/redaction.test.ts`
- `packages/agent-runtimes/src/pi-sdk-executor.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint D3: After Tasks 21-22

- [x] Fake-model integration proves read-only/write profiles, completion ordering, provider/tool failure, timeout, and cancellation.
- [x] Sessions and subscriptions are always disposed without a global Pi executable.
- [x] Inspectable events include required metadata but no credentials or hidden reasoning.

## Task 23: Run task loading and immutable repository selection

**Description:** Wire the start command, ClickUp snapshot, candidate repository
view, fresh read-only Pi session, selection schema, partition validation, and
profile-order normalization into the first vertical workflow slice.

**Acceptance criteria:**
- [x] A run starts only from a resolved task and ready profile, then validates a non-empty unique selected set plus exact excluded partition.
- [x] Unknown/duplicate/missing IDs fail; a valid selection is stored immutably in profile order with rationales/responsibilities.
- [x] No fetch, branch, worktree, active-checkout mutation, or later implicit selection change occurs in this slice.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- repository-selection && pnpm --filter @loop/api test -- task-resolve start-run`
- [x] Build succeeds: `pnpm --filter @loop/api build && pnpm --filter @loop/agent-runtimes build`
- [x] Manual check: run one- and multi-repository selection fixtures and inspect snapshots/events.

**Dependencies:** Tasks 12, 14, 15, and 22

**Files likely touched:**
- `packages/execution-runtime/src/services/repository-selection.ts`
- `packages/execution-runtime/src/executors/agent-executor-adapter.ts`
- `packages/execution-runtime/tests/services/repository-selection.test.ts`
- `apps/api/src/routes/clickup-tasks.ts`
- `apps/api/tests/start-run.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 24: Prepare ordered isolated Git worktrees

**Description:** Implement deterministic workspace preparation for the selected
subset: validate repository/target/remote, fetch without checkout mutation,
resolve exact base, reject collisions, create branch/worktree, and persist
partial ordered evidence.

**Acceptance criteria:**
- [x] Each selected repository gets one branch/worktree from its fetched target SHA in canonical profile order.
- [x] Collisions or later-repository failure stop without reuse/cleanup and retain every earlier local identity.
- [x] The user's active checkout and every excluded repository remain unchanged.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/gitlab-delivery test -- workspace git`
- [x] Build succeeds: `pnpm --filter @loop/gitlab-delivery build && pnpm --filter @loop/gitlab-delivery typecheck`
- [x] Manual check: use temporary repositories/bare remotes and compare active checkout state before and after all failure fixtures.

**Dependencies:** Tasks 10 and 23; approved branch template

**Files likely touched:**
- `packages/gitlab-delivery/package.json`
- `packages/gitlab-delivery/src/git.ts`
- `packages/gitlab-delivery/src/workspace.ts`
- `packages/gitlab-delivery/tests/workspace.test.ts`
- `packages/gitlab-delivery/src/index.ts`

**Estimated scope:** Medium: 3-5 files

## Task 25: Execute planning and implementation with durable handoffs

**Description:** Register the plan and implementation agent nodes so each uses
the selected worktrees, exact prior artifacts, typed results, per-repository
content, deterministic ClickUp publication, and committed implementation
evidence without changing the selected set.

**Acceptance criteria:**
- [x] Planning publishes/read-backs one `EXECUTION_PLAN` with cross-repository contracts and per-repository work.
- [x] Implementation commits each selected repository and publishes/read-backs one `IMPLEMENTATION_SUMMARY` with per-repository evidence.
- [x] Wrong selection discovery returns `blocked`; agents never publish to ClickUp directly or operate outside selected worktrees.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- plan-node implement-node`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/clickup-artifacts build`
- [x] Manual check: inspect fake multi-repository prompts, commits, artifact envelopes, and routing events.

**Dependencies:** Tasks 16, 22, and 24

**Files likely touched:**
- `packages/execution-runtime/src/executors/plan-node.ts`
- `packages/execution-runtime/src/executors/implement-node.ts`
- `packages/execution-runtime/src/services/artifact-publication.ts`
- `packages/execution-runtime/tests/executors/plan-node.test.ts`
- `packages/execution-runtime/tests/executors/implement-node.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint E1: After Tasks 23-25

- [ ] Task-to-selection-to-worktree-to-implementation runs work for one and several fake repositories.
- [ ] Selection/workspace/order/snapshot invariants remain immutable and inspectable.
- [ ] Plan/implementation artifacts are deterministic connector mutations with successful readback.

## Task 26: Normalize per-repository verification evidence

**Description:** Register the verification command node to run every selected
repository's bounded configured checks in profile order and produce structured,
sanitized repository-specific pass/failure evidence for routing and review.

**Acceptance criteria:**
- [x] Every selected repository command runs as an argument array with timeout and separate sanitized output.
- [x] All-pass selects `passed`; any failed check selects `failed-checks` with complete repository/command evidence.
- [x] Exit status alone never substitutes for a required structured verification record.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- verification-node`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/execution-runtime lint`
- [x] Manual check: execute mixed pass/fail fake repositories and inspect canonical ordering and redaction.

**Dependencies:** Tasks 10 and 25

**Files likely touched:**
- `packages/execution-runtime/src/executors/verification-node.ts`
- `packages/execution-runtime/src/services/verification-evidence.ts`
- `packages/execution-runtime/tests/executors/verification-node.test.ts`
- `packages/execution-runtime/tests/services/verification-evidence.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 27: Run sequential reviews and maintain one aggregate summary

**Description:** Execute fresh read-only requirements, security, and
simplification sessions sequentially, validate repository-addressed findings,
aggregate them deterministically, and publish/update/read-back the one
run-scoped review summary before routing.

**Acceptance criteria:**
- [x] Review sessions never overlap, cannot mutate worktrees, and use exact task/diff/verification inputs.
- [x] Aggregation produces `clean` or `changes-required` from validated findings and preserves prior review history.
- [x] Only aggregate-review publishes/updates `REVIEW_SUMMARY`; specialized outputs stay local.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- review-nodes aggregate-review`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/agent-runtimes build`
- [x] Manual check: assert fake session timestamps do not overlap and mutation tools are unavailable.

**Dependencies:** Tasks 17, 22, and 26

**Files likely touched:**
- `packages/execution-runtime/src/executors/review-node.ts`
- `packages/execution-runtime/src/executors/aggregate-review.ts`
- `packages/execution-runtime/src/services/review-findings.ts`
- `packages/execution-runtime/tests/executors/review-node.test.ts`
- `packages/execution-runtime/tests/executors/aggregate-review.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 28: Fix findings through the bounded re-verification loop

**Description:** Register the write-capable fix node to consume exact failed
verification and aggregated review evidence, change only scoped findings,
commit fixes per repository, and route back through complete verification and
all three fresh reviews until clean or transition exhaustion.

**Acceptance criteria:**
- [x] Fix receives only the exact current run evidence and cannot alter repository selection.
- [x] Every fix pass returns to verification and reruns all reviews; no retry/resume shortcut exists.
- [x] Commits and resolution evidence are preserved, while `blocked` or limit exhaustion terminates visibly.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/execution-runtime test -- fix-node review-loop transition-limit`
- [x] Build succeeds: `pnpm --filter @loop/execution-runtime build && pnpm --filter @loop/execution-runtime typecheck`
- [x] Manual check: trace zero, one, two, and over-limit fix cycles with exact event/summary history.

**Dependencies:** Tasks 9, 25, 26, and 27

**Files likely touched:**
- `packages/execution-runtime/src/executors/fix-node.ts`
- `packages/execution-runtime/src/services/finding-resolution.ts`
- `packages/execution-runtime/tests/executors/fix-node.test.ts`
- `packages/execution-runtime/tests/engine/review-loop.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint E2: After Tasks 26-28

- [x] Verification evidence is complete, ordered, bounded, and redacted.
- [x] Reviews are fresh, sequential, read-only, and aggregated into one durable lifecycle.
- [x] The explicit fix loop re-verifies/re-reviews and stops at the approved transition limit.

## Task 29: Create and verify one GitLab merge request per repository

**Description:** Enforce finalization preconditions, render repository-specific
MR metadata, push without force, call bounded authenticated `glab`, read each
opened MR back, and persist exact project/IID/URL/branch/base/head evidence in
profile order.

**Acceptance criteria:**
- [x] Finalization rejects dirty/mismatched worktrees, missing commits, unresolved review, duplicate MR, or inconsistent identities before unsafe mutation.
- [x] Each selected branch is pushed without history rewrite and yields one read-back-validated opened MR whose approved title/body covers task, changes, checks, risks, and rollback when applicable.
- [x] Failures preserve sanitized command evidence and every already-created external identity without retry, merge, approval, or pipeline claims.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/gitlab-delivery test -- preconditions mr-template finalizer`
- [x] Build succeeds: `pnpm --filter @loop/gitlab-delivery build && pnpm --filter @loop/gitlab-delivery lint`
- [x] Manual check: use bare remotes and a fake `glab`; inspect arguments, ordering, head SHA, and partial-failure evidence.

**Dependencies:** Tasks 24 and 28; approved MR templates

**Files likely touched:**
- `packages/gitlab-delivery/src/glab.ts`
- `packages/gitlab-delivery/src/mr-template.ts`
- `packages/gitlab-delivery/src/finalizer.ts`
- `packages/gitlab-delivery/src/errors.ts`
- `packages/gitlab-delivery/tests/finalizer.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 30: Finalize the complete multi-repository result in ClickUp

**Description:** After the entire selected MR set is verified, publish/read-back
one combined `FINALIZATION` artifact and only then move/read-back the task to
the configured In Review status, retaining partial evidence on any failure.

**Acceptance criteria:**
- [x] The artifact contains every selected repository, MR URL, exact base, and final head SHA in profile order.
- [x] Status movement cannot occur before complete MR/artifact readback and never occurs for a partial set.
- [x] Comment/status failure stops the run with GitLab evidence intact and no automatic repair, duplicate cleanup, merge, or deploy.

**Verification:**
- [x] Tests pass: `pnpm --filter @loop/gitlab-delivery test -- clickup-finalization multi-repository`
- [x] Build succeeds: `pnpm --filter @loop/gitlab-delivery build && pnpm --filter @loop/clickup-artifacts build`
- [x] Manual check: record fake connector call order for one/many repositories and every mutation failure point.

**Dependencies:** Tasks 17 and 29; configured In Review identifier

**Files likely touched:**
- `packages/gitlab-delivery/src/clickup-finalization.ts`
- `packages/gitlab-delivery/src/finalizer.ts`
- `packages/gitlab-delivery/tests/clickup-finalization.test.ts`
- `packages/gitlab-delivery/tests/multi-repository.test.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint E3: After Tasks 29-30

- [x] Headless one- and multi-repository workflows finish with one verified fake MR per selected repository.
- [x] External failure fixtures preserve truthful partial evidence and never move ClickUp early.
- [x] The runtime makes no pipeline, approval, merge, deployment, or stage-verification claim.

### UI implementation rule for Tasks 31-39

Before implementing each UI capability, browse the current official shadcn
blocks/components, run `shadcn info` and an official-registry search, read the
exact component docs, and inspect the closest candidate with `view` or
`add --dry-run`. Record this evidence in the task review. A custom primitive is
permitted only when no official composition satisfies the requirement, and
third-party registries still require separate approval.

## Task 31: Scaffold the minimal Next.js workbench application

**Description:** Create the pinned App Router application with a root route,
Server Component defaults, and typed API client boundary before adding the
visual foundation. Feature tasks add their own route entrypoints when the
backing flow exists; production standalone settings belong to Task 40.

**Acceptance criteria:**
- [ ] The root route renders through the App Router; later route files are deferred to their owning vertical slices.
- [ ] Browser code communicates only with the Hono API through a typed client and has no provider/Git/SQLite imports.
- [ ] Client Components are absent until a route has a concrete interaction boundary.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- routing api-client`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web typecheck`
- [ ] Manual check: inspect the client bundle/import graph for server-only or provider dependencies.

**Dependencies:** Tasks 1-3 and 13

**Files likely touched:**
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/lib/api-client.ts`

**Estimated scope:** Medium: 3-5 primary files; route placeholders are mechanical

## Task 32: Initialize the approved shadcn preset and operator shell

**Description:** From `apps/web`, run the exact approved preset command, inspect
the generated source, evaluate official `dashboard-01` and `sidebar-07` plus
current component docs/registry, and retain only the compact accessible shell
needed by the five routes.

**Acceptance criteria:**
- [ ] `components.json`, semantic tokens, aliases, primitive base, icon library, and pointer behavior come from `bddBUGsC` without decoding/reconstruction.
- [ ] Official block/component search, docs, and dry-run/view evidence is recorded before custom shell markup is accepted.
- [ ] The shell uses the 4 px/8 px rhythm, approved type hierarchy, keyboard navigation, visible focus, and no essential text below 12 px.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- app-shell`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web lint`
- [ ] Manual check: review every generated/retained source file and compare the shell at 1280 px with the visual/accessibility requirements.

**Dependencies:** Task 31; approved shadcn preset and current official catalog access

**Files likely touched:**
- `apps/web/components.json`
- `apps/web/app/globals.css`
- `apps/web/lib/utils.ts`
- `apps/web/components/app-shell.tsx`
- `apps/web/tests/app-shell.test.tsx`

**Estimated scope:** Medium: 3-5 primary files; preset-owned generated files are one reviewed scaffold

## Task 33: Inspect the immutable workflow graph and node contracts

**Description:** Render the selected revision through the approved deterministic
cyclic graph renderer with labeled edges, node-kind/start/terminal distinction,
pan/zoom, revision selection, and an accessible node inspector that does not
navigate away.

**Acceptance criteria:**
- [ ] Every node/outcome/edge in a revision renders with stable layout and topology remains read-only.
- [ ] Selection exposes common metadata plus agent harness/config or deterministic source/arguments as specified.
- [ ] Keyboard and non-color cues identify focus, selection, kind, start/terminal state, and recent run status.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- workflow-canvas workflow-node node-inspector`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web typecheck`
- [ ] Manual check: inspect the predefined cyclic graph at the supported desktop viewport using mouse and keyboard.

**Dependencies:** Tasks 6, 13, and 32; approved graph renderer/layout

**Files likely touched:**
- `apps/web/components/workflow/workflow-canvas.tsx`
- `apps/web/components/workflow/workflow-node.tsx`
- `apps/web/components/workflow/node-inspector.tsx`
- `apps/web/app/page.tsx`
- `apps/web/tests/workflow-inspection.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Checkpoint F1: After Tasks 31-33

- [ ] All routes, typed API boundary, preset source, and application shell build cleanly.
- [ ] The full immutable graph and every node kind are inspectable without topology mutation.
- [ ] Official shadcn evaluation and graph-dependency approval evidence are recorded.

## Task 34: Save agent configuration as a new revision

**Description:** Add validated inspector controls for the editable agent fields,
read-only Pi harness/version metadata, structured API errors, and revision
creation/selection that preserves the source revision and historical runs.

**Acceptance criteria:**
- [ ] Only provider, model, thinking, prompt, workspace policy, permissions, resources, schema reference, and timeout can be edited.
- [ ] Save creates and selects a distinct server-validated revision; the original and all run references remain unchanged.
- [ ] Invalid edits are associated with controls and never become optimistic persisted state.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- node-configuration workflow-revision`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web lint`
- [ ] Manual check: edit each field, compare old/new revisions, and reload both from the API.

**Dependencies:** Tasks 6, 13, and 33

**Files likely touched:**
- `apps/web/components/workflow/agent-node-form.tsx`
- `apps/web/components/workflow/node-inspector.tsx`
- `apps/web/lib/api-client.ts`
- `apps/web/tests/agent-node-form.test.tsx`
- `apps/web/tests/workflow-revision.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 35: Configure ordered project profiles and inspect readiness

**Description:** Build the settings slice for profile/shared ClickUp fields,
ordered candidate repositories, runtime-visible paths, bounded tool/check
arrays, connector states, and repository-addressable readiness while keeping
credentials connected/not-connected only.

**Acceptance criteria:**
- [ ] Operators can create/edit/reorder valid candidates and see the active runtime root/Compose path boundary.
- [ ] Filesystem, Git, tool, ClickUp, GitLab, and model findings are distinct per repository and never expose secrets.
- [ ] Saving settings does not mutate profile snapshots attached to active or historical runs.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- project-profile readiness-settings`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web typecheck`
- [ ] Manual check: exercise native and Compose path errors, reordering, missing credentials, and a historical snapshot.

**Dependencies:** Tasks 12 and 32

**Files likely touched:**
- `apps/web/app/settings/page.tsx`
- `apps/web/components/settings/profile-form.tsx`
- `apps/web/components/settings/readiness-panel.tsx`
- `apps/web/tests/profile-form.test.tsx`
- `apps/web/tests/readiness-panel.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 36: Resolve a task and start a confirmed run

**Description:** Build the start-run slice for ClickUp ID/URL, profile,
latest-valid/default revision, notes, read-only task resolution, candidate and
target confirmation, start mutation, and one-active-run conflict display.

**Acceptance criteria:**
- [ ] Submission remains disabled until the task, selected revision, profile, candidates, and targets are resolved and confirmed.
- [ ] The UI explains that the agent selects the affected subset after start and does not preselect repositories.
- [ ] A 409 preserves and links to the active run; structured errors remain associated and server-confirmed.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- start-run-form`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web lint`
- [ ] Manual check: exercise ID/URL, malformed task, unready profile, successful start, and active-run conflict fixtures.

**Dependencies:** Tasks 13, 15, 23, 32, and 35

**Files likely touched:**
- `apps/web/app/runs/new/page.tsx`
- `apps/web/components/runs/start-run-form.tsx`
- `apps/web/components/runs/task-confirmation.tsx`
- `apps/web/lib/api-client.ts`
- `apps/web/tests/start-run-form.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Checkpoint F2: After Tasks 34-36

- [ ] Agent edits create immutable revisions with accessible validation.
- [ ] Profiles expose ordered candidates and truthful readiness without changing snapshots.
- [ ] A confirmed task starts one run and handles the active-run conflict without optimistic divergence.

## Task 37: Follow and cancel a live multi-repository run over SSE

**Description:** Combine the graph with native EventSource, ordered event/log
rendering, elapsed/timing/status/outcome display, repository selection and
per-repository evidence, artifact/MR links, reconnect reconciliation, and the
server-confirmed cancel action.

**Acceptance criteria:**
- [ ] Persisted/live events update the exact pinned revision without gaps/duplicates after reconnect.
- [ ] All run/node states, selected transition, rationale, candidates, worktrees, checks, reviews, artifacts, and delivery evidence are textually visible.
- [ ] Cancel is shown only while legal and changes UI state only from the confirmed run snapshot/events.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- event-stream live-run cancel-run`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web typecheck`
- [ ] Manual check: replay synthetic success, failure, cancellation, interruption, reconnect, and multi-repository sequences.

**Dependencies:** Tasks 14, 23-30, and 33

**Files likely touched:**
- `apps/web/app/runs/[runId]/page.tsx`
- `apps/web/components/runs/run-status.tsx`
- `apps/web/components/runs/run-event-stream.tsx`
- `apps/web/lib/event-stream.ts`
- `apps/web/tests/live-run.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 38: Inspect paginated historical runs and exact evidence

**Description:** Implement newest-first run history and terminal detail modes
with profile/revision/task identity, durations, stopped node, full ordered
events, artifacts, errors, repository evidence, and MR links from exact
historical snapshots.

**Acceptance criteria:**
- [ ] Pagination is stable and shows required identity/status/timing plus available MR URLs.
- [ ] Opening a run renders its exact graph revision and complete evidence even after current configuration changes.
- [ ] UI wording distinguishes created MRs from pipeline, approval, merge, deployment, or release state.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- run-history historical-run`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web lint`
- [ ] Manual check: mutate current fake config after a terminal run and confirm historical display is unchanged.

**Dependencies:** Tasks 13, 30, 33, and 37

**Files likely touched:**
- `apps/web/app/runs/page.tsx`
- `apps/web/components/runs/run-history.tsx`
- `apps/web/components/runs/run-evidence.tsx`
- `apps/web/tests/run-history.test.tsx`
- `apps/web/tests/historical-run.test.tsx`

**Estimated scope:** Medium: 3-5 files

## Task 39: Prove desktop accessibility and browser acceptance flows

**Description:** Add Playwright acceptance for graph inspection, revision edit,
task resolution/start, live conditional execution, stopped failure,
cancellation, multi-repository success/history, and the supported desktop
accessibility requirements against an isolated fake-provider stack.

**Acceptance criteria:**
- [ ] All six specified operator journeys plus multi-repository/cancellation behavior pass at 1280 px or wider.
- [ ] Keyboard order, visible focus, accessible names/errors, non-color status, contrast, and no unsafe HTML are verified.
- [ ] Browser tests use isolated fakes and assert no direct provider/SQLite/API-container origin is exposed.

**Verification:**
- [ ] Tests pass: `pnpm test:e2e`
- [ ] Build succeeds: `pnpm --filter @loop/web build && pnpm --filter @loop/web test`
- [ ] Manual check: review screenshots/traces for dense scannability, brief functional motion, and untruncated durable evidence.

**Dependencies:** Tasks 34-38

**Files likely touched:**
- `tests/e2e/workflow-inspection.spec.ts`
- `tests/e2e/run-lifecycle.spec.ts`
- `tests/e2e/accessibility.spec.ts`
- `tests/e2e/fixtures/fake-stack.ts`
- `playwright.config.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint F3: After Tasks 37-39

- [ ] Component and Playwright suites pass at the supported desktop viewport.
- [ ] Live reconnect/cancel and historical snapshot behavior stay server-confirmed.
- [ ] Accessibility evidence covers controls, forms, graph, statuses, logs, and errors.

## Task 40: Build the standalone non-root Next.js image

**Description:** Configure standalone output and monorepo tracing, add a
lightweight web health endpoint, implement same-origin JSON/SSE proxy behavior,
and create a digest-pinned multi-stage image with only production assets and a
non-root runtime user.

**Acceptance criteria:**
- [ ] The image serves standalone Next.js on `0.0.0.0:3000` as non-root with a bounded local health check.
- [ ] Browser `/api` and SSE traffic reaches the internal API without exposing its Compose hostname or requiring CORS.
- [ ] Runtime layers exclude credentials, source-only dependencies, local evidence, and build-only tooling.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/web test -- health proxy`
- [ ] Build succeeds: `docker build -f apps/web/Dockerfile .`
- [ ] Manual check: inspect image history, effective user, copied paths, published response URLs, and SSE streaming.

**Dependencies:** Tasks 31, 37, and 39

**Files likely touched:**
- `apps/web/Dockerfile`
- `apps/web/next.config.ts`
- `apps/web/app/healthz/route.ts`
- `apps/web/tests/proxy.test.ts`
- `.dockerignore`

**Estimated scope:** Medium: 3-5 files

## Task 41: Build the non-root Hono and embedded-Pi runtime image

**Description:** Create the digest-pinned multi-stage API image containing the
compiled workspace, native SQLite runtime, embedded Pi SDK, and approved
baseline Git/glab/OpenSSH/CA/Bash/Node/Corepack/pnpm tools while keeping build
compilers and global Pi executables out of the final stage.

**Acceptance criteria:**
- [ ] The API runs as non-root on `0.0.0.0:3001`, writes only below `/var/lib/workbench`, and accesses repositories/worktrees only below `/workspace` in Compose mode.
- [ ] Required baseline tools and native SQLite load at their pinned compatible versions; no global Pi executable exists.
- [ ] Signals reach the API through an init boundary and allow the runtime's bounded graceful shutdown.

**Verification:**
- [ ] Tests pass: `pnpm --filter @loop/api test && pnpm --filter @loop/agent-runtimes test:integration`
- [ ] Build succeeds: `docker build -f apps/api/Dockerfile .`
- [ ] Manual check: inspect image user, tool versions, filesystem writes, layers, Pi executable absence, and SIGTERM behavior.

**Dependencies:** Tasks 14, 22, 24, and 30; agreed shared build-context exclusions with Task 40

**Files likely touched:**
- `apps/api/Dockerfile`
- `apps/api/src/server.ts`
- `apps/api/tests/container-runtime.test.ts`
- `.dockerignore`

**Estimated scope:** Medium: 3-5 files

## Checkpoint G1: After Tasks 40-41

- [ ] Both digest-pinned images build from the frozen lockfile and run as non-root.
- [ ] Web same-origin proxy and API graceful shutdown work in isolated containers.
- [ ] Image histories/layers contain no credentials, repositories, worktrees, database, or global Pi CLI.

## Task 42: Define the persistent two-service Compose stack and onboarding

**Description:** Add exactly `api` and `web` services on a private network,
bounded health/dependency behavior, named data volume, configurable workspace
bind mount, localhost-only web publication, non-secret environment template,
ignored workspace root, and safe operational README.

**Acceptance criteria:**
- [ ] `web` waits for healthy `api`; only `${APP_HOST:-127.0.0.1}:${APP_PORT:-3000}:3000` is published by default.
- [ ] `/var/lib/workbench` persists in a named volume and `${WORKSPACE_HOST_PATH:-./workspace}` maps only to `/workspace` without privileged/socket/root mounts.
- [ ] Missing external credentials still starts the inspectable app while readiness blocks runs; normal docs never delete volumes.

**Verification:**
- [ ] Tests pass: `docker compose config --quiet`
- [ ] Build succeeds: `docker compose build`
- [ ] Manual check: review the resolved Compose model, `.env.example`, ignored paths, quick start, logs, shutdown, and destructive-volume warning.

**Dependencies:** Tasks 12, 40, and 41

**Files likely touched:**
- `compose.yaml`
- `.env.example`
- `README.md`
- `workspace/.gitkeep`
- `workspace/.gitignore`

**Estimated scope:** Medium: 3-5 files

## Task 43: Automate clean-clone container and persistence acceptance

**Description:** Build an isolated container acceptance harness with fake
ClickUp/GitLab/model boundaries and a mounted fixture repository to prove
one-command health, same-origin API/SSE, non-root execution, connector
readiness, worktrees, graceful termination, and durable SQLite history across
recreate/down without touching real providers.

**Acceptance criteria:**
- [ ] Clean build and `docker compose up --build --wait --wait-timeout 120` reach healthy services with only the web port published.
- [ ] Empty credentials keep UI healthy but block runs; fake credentials plus a fixture repository complete a controlled workflow path.
- [ ] API recreate and normal `down` preserve history; termination leaves no false success/orphan process and no normal action removes the named volume.

**Verification:**
- [ ] Tests pass: `pnpm test:containers`
- [ ] Build succeeds: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm format:check`
- [ ] Manual check: inspect container users, published ports, named-volume data before/after recreate/down, fixture worktree, and sanitized logs.

**Dependencies:** Tasks 39-42

**Files likely touched:**
- `tests/container/compose.test.ts`
- `tests/container/fixtures/fake-providers.ts`
- `tests/container/fixtures/repository.ts`
- `package.json`
- `compose.yaml`

**Estimated scope:** Medium: 3-5 files

## Checkpoint G2: After Tasks 42-43

- [ ] All package, API, UI, browser, format, image, and container acceptance checks pass.
- [ ] Clean-clone startup, same-origin traffic, non-root, readiness separation, workspace boundary, shutdown, and persistence are proven.
- [ ] Automated acceptance uses no real credentials or external mutations.
- [ ] Human reviews the full evidence and separately authorizes any live-provider acceptance.
