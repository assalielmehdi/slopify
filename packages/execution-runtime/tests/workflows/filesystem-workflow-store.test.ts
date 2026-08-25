import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkflowFile } from '@slopify/workflow-model'
import { afterEach, describe, expect, it } from 'vitest'

import { createFilesystemWorkflowStore, resolveSlopifyPaths } from '../../src/index.js'

const directories: string[] = []

const workflow = (overrides: Partial<WorkflowFile> = {}): WorkflowFile => ({
  schemaVersion: 2,
  workflowId: 'release-review',
  name: 'Release review',
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

  it('reports invalid entries independently without rewriting their source', async () => {
    const fixture = createFixture()
    writeExternalWorkflow(fixture.paths, 'release-review', workflow())
    const invalidSource = '{ "schemaVersion": 2, invalid json'
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
        diagnostics: [expect.objectContaining({ code: 'WORKFLOW_DIRECTORY_INVALID' })],
      }),
    )
    expect(readFileSync(invalidPath, 'utf8')).toBe(invalidSource)
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
      value: { name: 'Release review' },
    })

    writeFileSync(
      definitionFile,
      `${JSON.stringify(workflow({ name: 'Updated review' }), null, 2)}\n`,
    )
    await expect(fixture.workflows.get('release-review')).resolves.toMatchObject({
      status: 'VALID',
      value: { name: 'Updated review' },
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
})
