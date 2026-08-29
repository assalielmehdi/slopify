import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/shared'
import { afterEach, describe, expect, it } from 'vitest'

import {
  calculateResourceRevision,
  createFilesystemWorkflowStore,
  resolveSlopifyPaths,
} from '../../src/index.js'

const directories: string[] = []

const workflow = (overrides: Partial<WorkflowFile> = {}): WorkflowFile => ({
  schemaVersion: 3,
  workflowId: 'release-review',
  description: 'Prepare and review a release.',
  repositories: {
    repositoryIds: ['repository-api'],
    primaryRepositoryId: 'repository-api',
  },
  variables: ['release'],
  graph: {
    startNodeId: 'prepare',
    nodes: [
      {
        type: 'agent',
        id: 'prepare',
        name: 'Prepare',
        prompt: 'Prepare {{ release }}.',
        harness: { harnessId: 'pi' },
        timeoutSeconds: 900,
      },
    ],
    edges: [],
    maxTransitions: 24,
  },
  createdAt: '2026-08-25T10:00:00.000Z',
  updatedAt: '2026-08-25T10:00:00.000Z',
  ...overrides,
})

const createFixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'slopify-workflows-'))
  directories.push(home)
  const paths = resolveSlopifyPaths({ environment: { SLOPIFY_HOME: home } })
  return { paths, workflows: createFilesystemWorkflowStore({ paths }) }
}

const writeExternalWorkflow = (
  paths: ReturnType<typeof resolveSlopifyPaths>,
  directoryId: string,
  value: unknown,
): string => {
  const directory = join(paths.workflowsDirectory, directoryId)
  mkdirSync(directory, { recursive: true })
  const definitionFile = join(directory, 'workflow.json')
  writeFileSync(definitionFile, `${JSON.stringify(value, null, 2)}\n`)
  return definitionFile
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('filesystem workflow store', () => {
  it('creates a versioned workflow file in its canonical directory', async () => {
    const fixture = createFixture()

    const created = await fixture.workflows.create(workflow())

    expect(created.value).toEqual(workflow())
    expect(created.revision).toMatch(/^[a-f0-9]{64}$/u)
    expect(
      JSON.parse(readFileSync(fixture.paths.workflow('release-review').definitionFile, 'utf8')),
    ).toEqual(workflow())
    await expect(fixture.workflows.create(workflow())).rejects.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    })
  })

  it('archives the complete workflow directory with its historical runs', async () => {
    const fixture = createFixture()
    await fixture.workflows.create(workflow())
    const historicalRunDirectory = join(
      fixture.paths.workflow('release-review').runsDirectory,
      'historical-run',
    )
    const historicalRun = join(historicalRunDirectory, 'run.json')
    mkdirSync(historicalRunDirectory, { recursive: true })
    writeFileSync(historicalRun, '{}\n')

    await expect(fixture.workflows.delete('release-review')).resolves.toBe(true)

    const archivedWorkflow = join(fixture.paths.archiveDirectory, 'release-review')
    expect(existsSync(fixture.paths.workflow('release-review').directory)).toBe(false)
    expect(existsSync(join(archivedWorkflow, 'workflow.json'))).toBe(true)
    expect(existsSync(join(archivedWorkflow, 'runs', 'historical-run', 'run.json'))).toBe(true)
    await expect(fixture.workflows.delete('release-review')).resolves.toBe(false)
  })

  it('keeps every archive when a workflow ID is reused', async () => {
    const fixture = createFixture()
    await fixture.workflows.create(workflow())
    await fixture.workflows.delete('release-review')
    await fixture.workflows.create(workflow())

    await expect(fixture.workflows.delete('release-review')).resolves.toBe(true)

    expect(
      existsSync(join(fixture.paths.archiveDirectory, 'release-review', 'workflow.json')),
    ).toBe(true)
    expect(
      existsSync(join(fixture.paths.archiveDirectory, 'release-review-2', 'workflow.json')),
    ).toBe(true)
  })

  it('reports unsupported workflow schema versions without rewriting their source', async () => {
    const fixture = createFixture()
    const unsupported = {
      ...workflow({ workflowId: 'test' }),
      schemaVersion: 99,
    }
    const definitionFile = writeExternalWorkflow(fixture.paths, 'test', unsupported)

    const stored = await fixture.workflows.get('test')

    expect(stored).toMatchObject({
      status: 'INVALID',
      workflowId: 'test',
    })
    expect(JSON.parse(readFileSync(definitionFile, 'utf8'))).toEqual(unsupported)
  })

  it('reports invalid entries independently without rewriting their source', async () => {
    const fixture = createFixture()
    writeExternalWorkflow(fixture.paths, 'release-review', workflow())
    const invalidSource = '{ "schemaVersion": 99, invalid json'
    const invalidPath = writeExternalWorkflow(fixture.paths, 'broken-workflow', workflow())
    writeFileSync(invalidPath, invalidSource)
    writeExternalWorkflow(
      fixture.paths,
      'mismatched-workflow',
      workflow({ workflowId: 'different-workflow' }),
    )
    writeExternalWorkflow(
      fixture.paths,
      'unreachable-workflow',
      workflow({
        workflowId: 'unreachable-workflow',
        graph: {
          ...workflow().graph,
          nodes: [
            ...workflow().graph.nodes,
            {
              type: 'agent',
              id: 'abandoned',
              name: 'Abandoned',
              prompt: 'This node cannot be reached.',
              harness: { harnessId: 'pi' },
            },
          ],
        },
      }),
    )
    writeExternalWorkflow(fixture.paths, 'invalid_graph', workflow({ workflowId: 'invalid_graph' }))

    const entries = await fixture.workflows.list()

    expect(entries).toHaveLength(5)
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 'VALID',
        workflowId: 'release-review',
        value: expect.objectContaining({ workflowId: 'release-review' }),
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'broken-workflow',
        source: invalidSource,
        revision: calculateResourceRevision(invalidSource),
        diagnostics: [expect.objectContaining({ code: 'WORKFLOW_FILE_MALFORMED' })],
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'mismatched-workflow',
        diagnostics: [expect.objectContaining({ code: 'WORKFLOW_ID_MISMATCH' })],
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'unreachable-workflow',
        diagnostics: [
          expect.objectContaining({
            code: 'WORKFLOW_GRAPH_INVALID',
            path: ['graph', 'nodes', 1, 'id'],
          }),
        ],
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'invalid_graph',
        diagnostics: [
          expect.objectContaining({
            code: 'WORKFLOW_DIRECTORY_INVALID',
            message:
              'Workflow directory name must use 1–64 lowercase letters, numbers, and single hyphens',
          }),
        ],
      }),
    )
    expect(readFileSync(invalidPath, 'utf8')).toBe(invalidSource)
  })

  it('saves against the exact revision and can repair invalid source', async () => {
    const fixture = createFixture()
    const definitionFile = writeExternalWorkflow(fixture.paths, 'release-review', workflow())
    const current = await fixture.workflows.get('release-review')
    if (current?.status !== 'VALID') throw new Error('Expected a valid workflow fixture')

    writeFileSync(definitionFile, '{ invalid')
    await expect(
      fixture.workflows.save({
        workflowId: 'release-review',
        value: workflow({ description: 'Stale update' }),
        expectedRevision: current.revision,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT' })

    const invalid = await fixture.workflows.get('release-review')
    if (invalid?.status !== 'INVALID' || invalid.revision === null) {
      throw new Error('Expected an invalid revisioned workflow fixture')
    }
    await expect(
      fixture.workflows.save({
        workflowId: 'release-review',
        value: workflow({ workflowId: 'different-workflow' }),
        expectedRevision: invalid.revision,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_ID_MISMATCH' })

    const repaired = await fixture.workflows.save({
      workflowId: 'release-review',
      value: workflow({ description: 'Repaired review' }),
      expectedRevision: invalid.revision,
    })
    expect(repaired.value.description).toBe('Repaired review')
    await expect(fixture.workflows.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      value: { description: 'Repaired review' },
    })
  })

  it('reflects external creation, repair, changes, and deletion on the next read', async () => {
    const fixture = createFixture()
    await expect(fixture.workflows.list()).resolves.toEqual([])

    const definitionFile = writeExternalWorkflow(fixture.paths, 'release-review', {
      ...workflow(),
      unexpected: true,
    })
    await expect(fixture.workflows.get('release-review')).resolves.toMatchObject({
      status: 'INVALID',
    })

    writeFileSync(definitionFile, `${JSON.stringify(workflow(), null, 2)}\n`)
    await expect(fixture.workflows.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      value: { workflowId: 'release-review' },
    })

    writeFileSync(
      definitionFile,
      `${JSON.stringify(workflow({ description: 'Updated review' }), null, 2)}\n`,
    )
    await expect(fixture.workflows.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      value: { description: 'Updated review' },
    })

    rmSync(fixture.paths.workflow('release-review').directory, { recursive: true })
    await expect(fixture.workflows.list()).resolves.toEqual([])
  })

  it('refuses symlinked workflow entries without following them', async () => {
    const fixture = createFixture()
    const outside = mkdtempSync(join(tmpdir(), 'slopify-workflow-outside-'))
    directories.push(outside)
    writeFileSync(join(outside, 'workflow.json'), `${JSON.stringify(workflow(), null, 2)}\n`)
    mkdirSync(fixture.paths.workflowsDirectory, { recursive: true })
    symlinkSync(outside, join(fixture.paths.workflowsDirectory, 'release-review'))

    await expect(fixture.workflows.list()).resolves.toEqual([
      expect.objectContaining({
        status: 'INVALID',
        workflowId: 'release-review',
        diagnostics: [expect.objectContaining({ code: 'WORKFLOW_DIRECTORY_INVALID' })],
      }),
    ])
  })

  it('refuses a symlinked workflow catalog root without reading or writing outside home', async () => {
    const fixture = createFixture()
    const outside = mkdtempSync(join(tmpdir(), 'slopify-workflows-root-outside-'))
    directories.push(outside)
    symlinkSync(outside, fixture.paths.workflowsDirectory)

    await expect(fixture.workflows.list()).rejects.toMatchObject({ code: 'WORKFLOW_UNAVAILABLE' })
    await expect(fixture.workflows.create(workflow())).rejects.toMatchObject({
      code: 'WORKFLOW_UNAVAILABLE',
    })
    expect(existsSync(join(outside, 'release-review'))).toBe(false)
  })
})
