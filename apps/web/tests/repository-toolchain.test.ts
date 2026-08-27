import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  engines?: Record<string, string>
  packageManager?: string
  scripts: Record<string, string>
}

interface TurboTask {
  cache?: boolean
  dependsOn?: string[]
  inputs?: string[]
  outputs?: string[]
  persistent?: boolean
}

interface TurboConfiguration {
  globalDependencies?: string[]
  tasks: Record<string, TurboTask>
}

const repositoryRoot = new URL('../../../', import.meta.url)
const workspaceManifestPaths = [
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/agent-runtimes/package.json',
  'packages/contracts/package.json',
  'packages/execution-runtime/package.json',
  'packages/workflow-model/package.json',
] as const
const libraryManifestPaths = workspaceManifestPaths.filter((path) => path.startsWith('packages/'))
const libraryPackageNames = [
  '@slopify/agent-runtimes',
  '@slopify/contracts',
  '@slopify/execution-runtime',
  '@slopify/workflow-model',
] as const
const forbiddenCommand =
  /(?:^|(?:&&|\|\||;)\s*)(?:node|npm|npx|pnpm|yarn|tsx|ts-node|deno|corepack)(?:\s|$)/u

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, repositoryRoot), 'utf8')) as T
}

describe('repository toolchain', () => {
  it('uses Bun as the only JavaScript package manager and runtime entry point', () => {
    const rootManifest = readJson<PackageManifest>('package.json')
    const manifests = [
      rootManifest,
      ...workspaceManifestPaths.map((path) => readJson<PackageManifest>(path)),
    ]

    expect(rootManifest.packageManager).toBe('bun@1.4.0')
    expect(rootManifest.engines).toEqual({ bun: '1.4.0' })
    expect(readFileSync(new URL('.bun-version', repositoryRoot), 'utf8').trim()).toBe('1.4.0')

    for (const manifest of manifests) {
      for (const command of Object.values(manifest.scripts)) {
        expect(command).toMatch(/^bun(?:\s|$)/u)
        expect(command).not.toMatch(forbiddenCommand)
      }
    }
  })

  it('delegates repository tasks to the pinned Turborepo CLI', () => {
    const rootManifest = readJson<PackageManifest>('package.json')

    expect(rootManifest.devDependencies?.turbo).toBe('2.10.11')
    expect(rootManifest.scripts).toMatchObject({
      build: 'bun --bun turbo run build',
      clean: 'bun --bun turbo run clean',
      dev: 'bun --bun turbo run dev --env-mode=loose',
      lint: 'bun --bun turbo run lint lint:root',
      start: 'bun --bun turbo run start --env-mode=loose',
      test: 'bun --bun turbo run test',
      typecheck: 'bun --bun turbo run typecheck typecheck:root',
    })
  })

  it('models dependency ordering, cached outputs, and persistent processes in Turbo', () => {
    const configuration = readJson<TurboConfiguration>('turbo.json')

    expect(configuration.globalDependencies).toEqual(
      expect.arrayContaining([
        'bunfig.toml',
        'eslint.config.mjs',
        'prettier.config.mjs',
        'tsconfig.base.json',
        'vitest.config.ts',
      ]),
    )
    expect(configuration.tasks.build).toEqual({
      dependsOn: ['^build'],
      outputs: ['dist/**', '.next/**', '!.next/cache/**', '!.next/dev/**'],
    })
    expect(configuration.tasks.dev).toEqual({
      dependsOn: ['^build'],
      cache: false,
      persistent: true,
    })
    for (const packageName of libraryPackageNames) {
      expect(configuration.tasks[`${packageName}#dev`]).toEqual({
        dependsOn: ['build', '^build'],
        cache: false,
        persistent: true,
      })
    }
    expect(configuration.tasks.start).toEqual({
      dependsOn: ['build'],
      cache: false,
      persistent: true,
    })
    expect(configuration.tasks.typecheck?.dependsOn).toEqual(['^build'])
    expect(configuration.tasks.test?.dependsOn).toEqual(['^build'])
    expect(configuration.tasks['@slopify/web#test']).toEqual({
      dependsOn: ['^build'],
      inputs: [
        '$TURBO_DEFAULT$',
        '$TURBO_ROOT$/.bun-version',
        '$TURBO_ROOT$/package.json',
        '$TURBO_ROOT$/turbo.json',
        '$TURBO_ROOT$/apps/api/package.json',
        '$TURBO_ROOT$/apps/api/src/server.ts',
        '$TURBO_ROOT$/packages/*/package.json',
      ],
      outputs: [],
    })
    expect(configuration.tasks).toHaveProperty('lint')
    expect(configuration.tasks).toHaveProperty('clean')
    expect(configuration.tasks).toHaveProperty('//#lint:root')
    expect(configuration.tasks).toHaveProperty('//#typecheck:root')
  })

  it('keeps workspace build and typecheck scripts package-local', () => {
    for (const path of workspaceManifestPaths) {
      const manifest = readJson<PackageManifest>(path)

      expect(manifest.scripts.build).not.toContain('bun run --filter')
      expect(manifest.scripts.typecheck).not.toContain('bun run --filter')
    }
  })

  it('watches shared package outputs during the repository development loop', () => {
    for (const path of libraryManifestPaths) {
      const manifest = readJson<PackageManifest>(path)

      expect(manifest.scripts.dev).toBe(
        'bun ../../node_modules/typescript-go/bin/tsc --project tsconfig.json --watch --preserveWatchOutput',
      )
    }
  })

  it('runs the Next.js and Hono lifecycle through Bun', () => {
    const webManifest = readJson<PackageManifest>('apps/web/package.json')
    const apiManifest = readJson<PackageManifest>('apps/api/package.json')
    const apiServer = readFileSync(new URL('apps/api/src/server.ts', repositoryRoot), 'utf8')

    expect(webManifest.scripts.clean).toContain("rmSync('.next'")
    expect(webManifest.scripts.build).toMatch(/^bun run clean &&/u)
    expect(webManifest.scripts.build).toContain('bun --bun next typegen')
    expect(webManifest.scripts.build).toContain('bun --bun next build')
    expect(webManifest.scripts.dev).toBe('bun --bun next dev --port 7310')
    expect(webManifest.scripts.start).toBe('bun --bun next start --port 7310')

    expect(apiManifest.dependencies?.hono).toBeDefined()
    expect(apiManifest.scripts.build).toMatch(/^bun run clean &&/u)
    expect(apiManifest.scripts.dev).toBe('bun --watch --conditions=source src/server.ts')
    expect(apiManifest.scripts.start).toBe('bun dist/server.js')
    expect(apiServer).toContain('Bun.serve')
  })
})
