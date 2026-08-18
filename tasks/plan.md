# Implementation Plan: Local AI Delivery Workbench V1

## Plan status

**Approved for incremental implementation on 2026-08-18.** The user approved
the mapped specification set and this decomposition. Task-specific decisions
that still lack concrete project data remain explicit dependencies before the
affected task, and real external mutations remain separately gated.

Task details are tracked in [`tasks/todo.md`](./todo.md).

## Overview

Build a local, single-user TypeScript workbench that executes one revisioned,
predefined software-delivery graph. A run resolves a self-contained ClickUp
task, lets a fresh embedded Pi SDK session select the affected repositories,
creates isolated Git worktrees for that immutable subset, plans, implements,
verifies, reviews, fixes when needed, creates one verified GitLab merge request
per selected repository, publishes the complete evidence to ClickUp, and moves
the task to In Review. A Next.js operator console exposes configuration, graph
inspection, live events, cancellation, and durable SQLite-backed history. The
same application must run natively or as a two-service Docker Compose stack.

## Sources and scope

This plan covers every module mapped by `.local/specs/CAPABILITY-MAP.md`:

| Capability | Detailed tasks |
|---|---:|
| Cross-cutting workspace and contracts | 1-3 |
| `workflow-model` | 4-6 |
| `execution-runtime` | 7-14, 23, 26-28 |
| `clickup-artifacts` | 15-17, 25, 30 |
| `agent-runtimes` | 18-22, 23, 25, 27-28 |
| `gitlab-delivery` | 24, 29-30 |
| `workflow-workbench` | 31-39 |
| `deployment-packaging` | 40-43 |

### Requirement traceability

| Normative requirement group | Tasks |
|---|---:|
| Workflow variants, edge cardinality, validation, cycles, revisions, and predefined topology | 4-6 |
| SQLite schema, snapshots, lifecycle/events, traversal, process execution, and transition bounds | 7-10 |
| Health, workflow/profile/connector/run APIs, one-active-run, SSE, cancellation, shutdown, and interruption | 11-14 |
| ClickUp task resolution, exact artifacts, review-summary lifecycle, and guarded status movement | 15-17, 25, 27, 30 |
| Pi tools, typed completion, prompts/resources, credentials, sessions, events, redaction, and cancellation | 18-23, 25, 27-28 |
| Repository selection, worktrees, planning/implementation, verification, sequential reviews, and fix loop | 23-28 |
| GitLab preconditions, non-force push, MR creation/readback, partial evidence, and ClickUp finalization | 24, 29-30 |
| Graph/inspector, revision edit, settings/readiness, start, live run, history, and accessibility | 31-39 |
| Standalone images, same-origin proxy, two-service Compose, persistence, onboarding, and container acceptance | 40-43 |

Out of scope remains exactly as stated by the specifications: authentication,
remote hosting, multiple active runs, parallel node execution, retry/resume or
replay, automatic cleanup or reconciliation, visual graph authoring, agent
harness selection, arbitrary task-sourced commands, pipeline waiting, merge,
deployment, and stage verification.

## Planning assumptions

- `.local/specs/CAPABILITY-MAP.md` and its seven linked module specs are the
  complete V1 source of truth.
- No current implementation or repository-local task tracker exists, so the
  skill's default `tasks/todo.md` target is used.
- The normative project structure and commands are targets, not evidence that
  runnable tooling already exists.
- Dependency versions are discovered from official/current sources only when
  Task 1 starts, then pinned exactly; this plan does not guess future versions.
- External systems are exercised through fakes in automated tests. Disposable
  real ClickUp, GitLab, and model-provider accounts remain a separately
  authorized manual acceptance gate.
- Every implementation task is limited to one focused session and no more than
  five primary files. If actual repository structure forces a larger diff, the
  task must be split before coding.

## Approval decisions required before the relevant implementation task

| Decision | Recommendation | Why it matters |
|---|---|---|
| Specification status and plan | **Approved 2026-08-18** | The mapped V1 set and decomposition are the implementation baseline. |
| Workflow transition limit | **Approved: 24 transitions** | The clean path uses 11 transitions; two full review/fix cycles use 23, leaving a visible hard bound without permitting an unbounded loop. |
| Pi defaults | Select provider, model, thinking level, and whether an explicit read-only credential-file mount is supported | These values are revisioned/readiness-visible and cannot be chosen safely from repository evidence. |
| Pi compaction | **Approved: disabled in V1** | This is the smallest inspectable behavior and avoids hidden context changes. |
| Graph renderer/layout | **Approved baseline: `@xyflow/react` 12.11.3 with `@dagrejs/dagre` 3.1.1** | The maintained pair supports typed custom nodes/edges, pan/zoom, and deterministic layout of the read-only cyclic workflow. |
| First profile conventions | Supply/approve ClickUp workspace/list/In Review identifiers plus branch and MR templates before live manual acceptance | The implementation can be generic, but real mutations need exact operator configuration. |

## Architecture decisions

- Use one pnpm workspace with `apps/web`, `apps/api`, and framework-independent
  packages. Do not introduce a monorepo framework.
- Keep Zod contracts at every persistence, API, SDK, CLI, ClickUp, and GitLab
  boundary. Keep provider wire types private to their adapter packages.
- Treat the workflow revision, project-profile snapshot, repository selection,
  and workspaces as immutable run inputs after their respective validation
  points.
- Keep routing and all external mutations deterministic. Agent prose never
  chooses a downstream node and never calls ClickUp or GitLab directly.
- Use one SQLite file with foreign keys, transactions, and WAL. Persist state
  changes and their observable events atomically.
- Use one fresh in-memory embedded Pi SDK session per agent node, an explicit
  tool allowlist, one typed `complete_node` result, and application-owned
  resources. Do not invoke or require a global Pi executable.
- Make the runtime the only owner of node lifecycle, transition bounds,
  cancellation truth, process groups, restart reconciliation, and one-active-
  run enforcement.
- Keep the browser behind the Hono API. In Compose, proxy JSON and SSE through
  the Next.js origin and publish only the web port by default.
- Build user-visible functionality as vertical paths once the shared model and
  runtime foundations are stable: task selection, workspace execution,
  verification/review loop, finalization, then operator UI.

## Execution discipline

- Use incremental implementation for every task: one independently verifiable
  slice, then test, verify, and commit before expanding.
- Use test-driven development for logic and behavior. Configuration-only and
  documentation-only increments use direct validation instead of artificial
  failing tests.
- Apply API and interface design to shared contracts, persistence boundaries,
  backend services, external adapters, and Hono routes.
- Apply the Next.js, React performance, and frontend UI engineering skills to
  Tasks 31-40, including Server Component defaults, bounded client islands,
  accessibility, responsive behavior, and runtime browser verification.
- Resolve current library, framework, SDK, API, and CLI contracts through
  Context7 and primary official sources before implementing against them.

## Dependency graph

```text
Pinned workspace + shared contracts
                |
        Workflow model/revision
                |
    Persistence + run engine + API
        /                   \
ClickUp artifacts      Embedded Pi SDK
        \                   /
     Task selection and execution paths
                |
       Git workspace preparation
                |
 Verification -> reviews -> fix loop
                |
  GitLab MR set -> ClickUp finalization
                |
      Workbench vertical UI paths
                |
       Two-service Compose packaging
```

Database migrations, public contracts, workflow revision semantics, and shared
external-mutation ordering are sequential. After those contracts are fixed,
adapter internals and independent UI pages may be developed in parallel, but
their integration checkpoints remain ordered.

## Task list

### Phase 1: Reproducible foundation

- [ ] Task 1: Resolve and pin the supported toolchain and direct dependencies
- [ ] Task 2: Establish workspace-wide build, typecheck, lint, test, and format contracts
- [ ] Task 3: Define shared identifiers, API errors, events, artifacts, and repository contracts

### Checkpoint A: Workspace foundation

- [ ] Frozen installation succeeds from a clean checkout
- [ ] Root quality commands execute without floating dependency resolution
- [ ] Human approves the exact dependency set and graph-renderer decision

### Phase 2: Workflow model

- [x] Task 4: Model and parse workflow node and edge variants
- [x] Task 5: Validate graph topology, outcomes, registrations, and transition bounds
- [x] Task 6: Ship the predefined revisioned V1 graph and pure inspection queries

### Checkpoint B: Executable graph contract

- [x] All workflow-model invariants have explicit passing and failing fixtures
- [x] The cyclic V1 graph validates with the approved transition limit
- [x] Published revisions are immutable and fully displayable

### Phase 3: Runtime core

- [ ] Task 7: Initialize the SQLite schema and connection boundary
- [ ] Task 8: Persist atomic lifecycle changes and ordered events
- [ ] Task 9: Execute and route one graph node at a time
- [ ] Task 10: Run bounded deterministic child processes truthfully
- [ ] Task 11: Compose the Hono API, health contract, and shared error boundary
- [ ] Task 12: Manage project profiles and repository-addressable readiness
- [ ] Task 13: Expose run creation, inspection, pagination, and ordered SSE
- [ ] Task 14: Implement cancellation, graceful shutdown, and restart interruption

### Checkpoint C: Runtime without live providers

- [ ] A fake workflow runs to terminal state with gap-free persisted events
- [ ] Active work can be cancelled and an interrupted process is reconciled truthfully
- [ ] One-active-run, pagination, health, profile readiness, and SSE contracts pass

### Phase 4: ClickUp and Pi boundaries

- [ ] Task 15: Resolve and validate canonical ClickUp task snapshots
- [ ] Task 16: Render, publish, read back, and retrieve exact ClickUp artifacts
- [ ] Task 17: Preserve review-summary identity and guard the In Review transition
- [ ] Task 18: Define Pi execution contracts and tool profiles
- [ ] Task 19: Enforce typed single-call agent completion
- [ ] Task 20: Render bounded prompts and application-owned resource bundles
- [ ] Task 21: Construct and terminate fresh Pi SDK sessions
- [ ] Task 22: Normalize and redact observable Pi events

### Checkpoint D: Provider adapters

- [ ] Fake ClickUp and fake model-provider suites pass without real credentials
- [ ] Read-only agents cannot mutate; write agents see only selected worktrees
- [ ] No hidden reasoning, global Pi resources, or secrets reach persistence or browser contracts

### Phase 5: End-to-end workflow slices

- [ ] Task 23: Run task loading and immutable repository selection
- [ ] Task 24: Prepare ordered isolated Git worktrees from exact fetched bases
- [ ] Task 25: Execute plan and implementation nodes with durable handoff artifacts
- [ ] Task 26: Normalize per-repository verification evidence
- [ ] Task 27: Run sequential reviews and maintain one aggregate review summary
- [ ] Task 28: Fix findings and enforce the bounded verify/re-review loop
- [ ] Task 29: Validate delivery and create verified GitLab merge requests
- [ ] Task 30: Finalize the complete multi-repository result in ClickUp

### Checkpoint E: Headless workflow acceptance

- [ ] One- and multi-repository fake-provider runs reach the correct terminal state
- [ ] Failure and partial-mutation cases preserve evidence without retries or false success
- [ ] No user checkout, historical snapshot, or selected-repository set is mutated

### Phase 6: Operator workbench

- [ ] Task 31: Scaffold the minimal Next.js workbench application
- [ ] Task 32: Initialize the approved shadcn preset and operator shell
- [ ] Task 33: Inspect the immutable workflow graph and node contracts
- [ ] Task 34: Save agent configuration as a new immutable revision
- [ ] Task 35: Configure ordered project profiles and inspect readiness
- [ ] Task 36: Resolve a ClickUp task and start a confirmed run
- [ ] Task 37: Follow and cancel a live multi-repository run over SSE
- [ ] Task 38: Inspect paginated historical runs and exact evidence
- [ ] Task 39: Prove desktop accessibility and browser acceptance flows

### Checkpoint F: Workbench acceptance

- [ ] The approved desktop flows pass with fake provider boundaries
- [ ] Status, focus, errors, logs, and graph inspection meet the accessibility contract
- [ ] UI claims remain server-confirmed and distinguish MR creation from merge/deployment

### Phase 7: Deployment packaging

- [ ] Task 40: Build the standalone non-root Next.js image and same-origin proxy
- [ ] Task 41: Build the non-root Hono and embedded-Pi runtime image
- [ ] Task 42: Define the persistent, health-checked two-service Compose stack and onboarding
- [ ] Task 43: Automate clean-clone container and persistence acceptance

### Checkpoint G: V1 complete

- [ ] All root build, typecheck, lint, unit, integration, browser, and format checks pass
- [ ] Compose config, build, health, same-origin API/SSE, non-root, and persistence checks pass
- [ ] No automated test uses real provider credentials or mutates real ClickUp/GitLab data
- [ ] Human reviews automated evidence before separately authorizing live-provider acceptance

## Verification strategy

Each task has focused commands in `tasks/todo.md`. At every checkpoint, run the
broader repository commands that exist by then:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm format:check
docker compose config --quiet
docker compose up --build --wait --wait-timeout 120
docker compose down
```

Claims stay separated:

1. package/unit/contract proof;
2. headless workflow integration proof with fakes;
3. browser acceptance proof against an isolated stack;
4. container startup and persistence proof; and
5. separately authorized live-provider proof.

None of these implies a generated MR was merged, deployed, or verified on a
stage environment.

## Parallelization opportunities

- After Checkpoint B, ClickUp client internals and Pi adapter internals can be
  implemented independently against fixed shared contracts.
- After Checkpoint C and the common web scaffold, profile settings UI and
  immutable graph inspection UI can proceed independently against API fakes.
- After Checkpoint E and an agreed build-context exclusion contract, historical
  UI work and API-image construction can proceed independently.
- Database schema changes, public contract changes, workflow revision changes,
  runtime routing, review-summary updates, and finalization ordering must remain
  sequential or be coordinated through an approved contract-first task.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pi SDK API or package compatibility differs from the draft spec | High | Resolve against current official package documentation in Task 1, pin lockstep versions, and fail early with a fake-provider adapter test. |
| Native `better-sqlite3` build/runtime mismatch in containers | High | Pin a compatible Node/base-image combination early and prove the production runtime in Tasks 41 and 43. |
| Cancellation is reported before work actually stops | High | Require abort/termination confirmation, idle wait, disposal, and explicit failure when confirmation is impossible. |
| Partial multi-repository GitLab mutations create ambiguity | High | Persist each external identity immediately, preserve canonical profile order, block ClickUp finalization until the complete set is verified, and provide no automatic repair in V1. |
| Task content causes command or prompt injection | High | Treat ClickUp content as untrusted data, permit only registered argument-array commands, use fixed tool profiles, and validate typed completion at the application boundary. |
| Workflow revision or project settings drift changes history | High | Snapshot and reference immutable workflow/profile/configuration records for each run. |
| SSE reconnect duplicates or drops visible state | Medium | Persist sequence numbers, replay ordered events, reconcile with the run snapshot, and deduplicate by run sequence. |
| UI component or graph dependency expands scope | Medium | Approve the graph dependency first and require official shadcn catalog/CLI evidence before custom primitives. |
| Compose starts but a project cannot execute | Medium | Keep container health separate from connector/profile readiness and test both states explicitly. |
| Missing project-wide Definition of Done reference | Medium | Use the initiative success criteria plus Checkpoint G until a repository-specific Definition of Done is approved. |

## Open questions

1. Which Pi provider, model, and thinking-level defaults should the first
   revision expose?
2. Should V1 support an optional explicitly mounted Pi credential file, or
   environment variables only?
3. What exact ClickUp workspace, list, and In Review identifiers will the first
   disposable acceptance profile use?
4. What branch and merge-request title/body conventions will the first project
   profile use?
5. Is the separately authorized live-provider acceptance gate required before
   declaring V1 complete, or is fake-boundary plus container acceptance the V1
   completion boundary?

## Plan review checklist

- [x] Every mapped specification has task coverage.
- [x] Dependencies are explicit and ordered foundation-first.
- [x] Feature behavior is integrated through vertical workflow and UI slices.
- [x] Every detailed task has acceptance criteria, verification, dependencies,
  likely files, and an XS/S/M estimate.
- [x] Checkpoints occur after every two or three tasks within a phase.
- [x] No task is planned to exceed five primary files.
- [x] Human approved the specification baseline and plan; later task-specific
  project/profile decisions remain explicit dependencies.
