import { describe, expect, it } from 'vitest'

import { resolveSlopifyPaths } from '../../src/index.js'

describe('Slopify filesystem paths', () => {
  it('places every durable resource directly below ~/.slopify by default', () => {
    const paths = resolveSlopifyPaths({ environment: {}, homeDirectory: '/Users/operator' })

    expect(paths).toMatchObject({
      home: '/Users/operator/.slopify',
      settingsFile: '/Users/operator/.slopify/settings.json',
      repositoriesFile: '/Users/operator/.slopify/repositories.json',
      schemasDirectory: '/Users/operator/.slopify/schemas',
      workflowsDirectory: '/Users/operator/.slopify/workflows',
      archiveDirectory: '/Users/operator/.slopify/archive',
      runtimeDirectory: '/Users/operator/.slopify/runtime',
    })
  })

  it('uses SLOPIFY_HOME and resolves workflow and run resources from one home', () => {
    const paths = resolveSlopifyPaths({
      environment: { SLOPIFY_HOME: '/private/tmp/slopify-test' },
      homeDirectory: '/unused',
    })

    expect(paths.workflow('workflow-01')).toEqual({
      directory: '/private/tmp/slopify-test/workflows/workflow-01',
      definitionFile: '/private/tmp/slopify-test/workflows/workflow-01/workflow.json',
      runsDirectory: '/private/tmp/slopify-test/workflows/workflow-01/runs',
    })
    expect(paths.run('workflow-01', 'run-01')).toEqual({
      directory: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01',
      runFile: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/run.json',
      workflowSnapshotFile:
        '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/workflow.snapshot.json',
      variablesFile: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/variables.json',
      repositoriesSnapshotFile:
        '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/repositories.snapshot.json',
      workspacesFile: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/workspaces.json',
      eventsFile: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/events.jsonl',
      artifactsDirectory: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/artifacts',
      nodesDirectory: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/nodes',
      workspacesDirectory: '/private/tmp/slopify-test/workflows/workflow-01/runs/run-01/workspaces',
    })
  })

  it.each([
    ['workflow', () => resolveSlopifyPaths().workflow('../escape')],
    ['workflow', () => resolveSlopifyPaths().workflow('nested/workflow')],
    ['workflow', () => resolveSlopifyPaths().workflow('invalid_workflow')],
    ['workflow', () => resolveSlopifyPaths().workflow('a'.repeat(65))],
    ['run', () => resolveSlopifyPaths().run('workflow-01', '../../escape')],
    ['run', () => resolveSlopifyPaths().run('workflow-01', '/absolute')],
  ])('rejects an invalid %s identifier before constructing a path', (_kind, resolvePath) => {
    expect(resolvePath).toThrow(TypeError)
  })

  it('rejects a blank SLOPIFY_HOME override', () => {
    expect(() =>
      resolveSlopifyPaths({ environment: { SLOPIFY_HOME: '  ' }, homeDirectory: '/unused' }),
    ).toThrow(TypeError)
  })
})
