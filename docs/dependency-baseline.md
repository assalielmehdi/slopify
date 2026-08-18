# Dependency Baseline

Resolved on 2026-08-18 from the official Node.js release schedule, npm package
metadata, package documentation, and the Docker Official Image manifest.
Versions are exact and non-prerelease. Add each package only to the workspace
that owns it; do not install this full list at the root.

## Toolchain

| Dependency                     |   Version |
| ------------------------------ | --------: |
| Node.js Active LTS             | `24.18.0` |
| pnpm                           | `11.22.0` |
| TypeScript                     |   `5.9.3` |
| `@types/node`                  | `24.13.3` |
| ESLint                         |  `10.8.1` |
| `@eslint/js`                   |  `10.0.1` |
| `typescript-eslint`            |  `8.67.0` |
| Prettier                       |   `3.9.6` |
| Vitest / `@vitest/coverage-v8` |  `4.1.11` |

TypeScript 7.0.2 was not selected because `typescript-eslint` 8.67.0 requires
TypeScript below 6.1. TypeScript 5.9.3 is the newest stable release satisfying
the selected lint toolchain; no stable TypeScript 6 release exists.

## Application packages

| Dependency                        |   Version |
| --------------------------------- | --------: |
| Next.js                           |  `16.3.1` |
| React / React DOM                 |  `19.2.8` |
| `@types/react`                    | `19.2.18` |
| `@types/react-dom`                |  `19.2.4` |
| Hono                              |  `4.13.3` |
| `@hono/node-server`               |   `2.1.1` |
| Zod                               |   `4.4.3` |
| `better-sqlite3`                  |  `13.0.3` |
| `@types/better-sqlite3`           |   `9.6.0` |
| `@earendil-works/pi-coding-agent` |  `0.84.2` |
| `@earendil-works/pi-ai`           |  `0.84.2` |
| `typebox`                         |   `1.3.7` |
| Execa                             |  `10.0.1` |

The Pi packages are pinned in lockstep. `typebox` matches the exact version
used by Pi 0.84.2 so the completion-tool boundary does not introduce a second
TypeBox version.

## Frontend and test packages

| Dependency                  |   Version |
| --------------------------- | --------: |
| `@xyflow/react`             | `12.11.3` |
| `@dagrejs/dagre`            |   `3.1.1` |
| shadcn CLI                  |  `4.18.0` |
| `@playwright/test`          |  `1.62.1` |
| `@testing-library/react`    |  `16.3.2` |
| `@testing-library/dom`      |  `10.4.1` |
| `@testing-library/jest-dom` |   `7.0.1` |
| jsdom                       |  `30.0.1` |

React Flow is the approved read-only graph renderer. Dagre provides a small,
deterministic directed layout and supports cycle removal for layout while the
workflow model retains the original cyclic edges. `@dagrejs/dagre` ships its
own TypeScript declarations, so `@types/dagre` is intentionally excluded.

## Container base

Use the multi-platform Docker Official Image manifest:

```text
node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
```

The API and web runtime stages may share this base. Repository-specific
toolchains remain outside the baseline image unless separately approved.
