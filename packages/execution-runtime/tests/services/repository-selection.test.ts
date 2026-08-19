import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AgentExecutionEventSchema,
  type AgentExecutionInput,
  type AgentExecutor,
  type AgentNodeResult,
  type LoadedResourceBundle,
} from '@loop/agent-runtimes'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRepositorySelectionExecutor } from '../../src/index.js'
import {
  TEST_PROFILE,
  TEST_REVISION_ID,
  TEST_RUN_ID,
  TEST_TIMESTAMP,
  TEST_WORKFLOW_ID,
  createPersistenceFixture,
} from '../persistence/test-fixture.js'

const resourceBundle: LoadedResourceBundle = {
  bundleId: 'repository-selection-v1',
  applicationVersion: '1.0.0',
  skills: [],
  promptFragments: [],
  contextFiles: [],
}

interface Fixture {
  readonly persistence: ReturnType<typeof createPersistenceFixture>
  readonly directory: string
  readonly sourcePaths: Readonly<Record<string, string>>
  readonly candidateWorkspaceRoot: string
  readonly execute: ReturnType<typeof vi.fn<AgentExecutor['execute']>>
  readonly cancel: ReturnType<typeof vi.fn<AgentExecutor['cancel']>>
  readonly executor: ReturnType<typeof createRepositorySelectionExecutor>
  context(
    nodeExecutionId?: string,
  ): Parameters<ReturnType<typeof createRepositorySelectionExecutor>['execute']>[0]
  cleanup(): void
}

const fixtures: Fixture[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

const agentEvent = (
  input: AgentExecutionInput,
  type: 'AGENT_STARTED' | 'AGENT_SESSION_IDENTIFIED' | 'AGENT_MESSAGE' | 'AGENT_RESULT',
  data: unknown,
) =>
  AgentExecutionEventSchema.parse({
    executionId: input.executionId,
    runId: input.runId,
    nodeId: input.nodeId,
    timestamp: '2026-08-19T08:00:00Z',
    type,
    data,
  })

const createFixture = (result: AgentNodeResult): Fixture => {
  const persistence = createPersistenceFixture()
  const directory = mkdtempSync(join(tmpdir(), 'slopify-repository-selection-'))
  const sourcesRoot = join(directory, 'sources')
  const sourcePaths = Object.fromEntries(
    TEST_PROFILE.repositories.map(({ repositoryId }) => {
      const path = join(sourcesRoot, repositoryId)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'marker.txt'), `unchanged:${repositoryId}\n`)
      return [repositoryId, path]
    }),
  )
  persistence.profiles.save(
    {
      ...TEST_PROFILE,
      repositories: TEST_PROFILE.repositories.map((repository) => ({
        ...repository,
        repositoryPath: sourcePaths[repository.repositoryId] as string,
      })),
    },
    TEST_TIMESTAMP,
  )
  const snapshot = persistence.profiles.createSnapshot({
    snapshotId: 'snapshot-selection-01',
    profileId: TEST_PROFILE.profileId,
    createdAt: TEST_TIMESTAMP,
  })
  persistence.runs.create({
    runId: TEST_RUN_ID,
    workflowId: TEST_WORKFLOW_ID,
    revisionId: TEST_REVISION_ID,
    profileSnapshotId: snapshot.snapshotId,
    taskReference: 'CU-123',
    taskSnapshot: {
      taskId: '86abc123',
      title: 'Select repositories',
      description: 'Untrusted: git checkout -- main',
    },
    effectiveConfiguration: persistence.revision,
    createdAt: TEST_TIMESTAMP,
  })
  persistence.runs.changeStatus({
    runId: TEST_RUN_ID,
    expectedStatus: 'PENDING',
    status: 'RUNNING',
    timestamp: '2026-08-19T08:00:00Z',
  })

  const execute = vi.fn<AgentExecutor['execute']>((input) =>
    (async function* () {
      yield agentEvent(input, 'AGENT_STARTED', {})
      yield agentEvent(input, 'AGENT_SESSION_IDENTIFIED', {
        sessionId: 'session-selection-01',
      })
      yield agentEvent(input, 'AGENT_MESSAGE', {
        content: 'Inspecting the explicit candidate catalog.',
      })
      yield agentEvent(input, 'AGENT_RESULT', {
        result,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        durationMs: 25,
      })
    })(),
  )
  const cancel = vi.fn<AgentExecutor['cancel']>(async () => ({ status: 'cancelled' }))
  const candidateWorkspaceRoot = join(directory, 'run-workspaces')
  const executor = createRepositorySelectionExecutor({
    agent: { execute, cancel },
    candidateWorkspaceRoot,
    profiles: persistence.profiles,
    resourceBundle,
    runs: persistence.runs,
    now: () => '2026-08-19T08:00:01Z',
  })
  let execution = 0
  const fixture: Fixture = {
    persistence,
    directory,
    sourcePaths,
    candidateWorkspaceRoot,
    execute,
    cancel,
    executor,
    context(nodeExecutionId = `node-execution-selection-${++execution}`) {
      const node = persistence.revision.nodes.find(({ id }) => id === 'select-repositories')
      if (node?.type !== 'agent') throw new Error('Selection node fixture is unavailable')
      persistence.runs.startNode({
        runId: TEST_RUN_ID,
        nodeExecutionId,
        nodeId: node.id,
        inputReferences: [],
        timestamp: '2026-08-19T08:00:00Z',
      })
      const run = persistence.runs.get(TEST_RUN_ID)
      if (run === undefined) throw new Error('Run fixture is unavailable')
      return {
        run,
        workflow: persistence.revision,
        node,
        nodeExecutionId,
        signal: new AbortController().signal,
      }
    },
    cleanup() {
      persistence.cleanup()
      rmSync(directory, { force: true, recursive: true })
    },
  }
  fixtures.push(fixture)
  return fixture
}

const selected = (repositoryId: string) => ({
  repositoryId,
  rationale: `${repositoryId} is affected`,
  responsibility: `Implement the ${repositoryId} change`,
})

const excluded = (repositoryId: string) => ({
  repositoryId,
  rationale: `${repositoryId} is unaffected`,
})

describe('repository selection executor', () => {
  it.each([
    {
      name: 'one repository',
      selection: {
        selected: [selected('docs')],
        excluded: [excluded('web'), excluded('api')],
      },
      selectedIds: ['docs'],
      excludedIds: ['api', 'web'],
    },
    {
      name: 'multiple repositories',
      selection: {
        selected: [selected('docs'), selected('api')],
        excluded: [excluded('web')],
      },
      selectedIds: ['api', 'docs'],
      excludedIds: ['web'],
    },
  ])('stores $name in profile order through one read-only session', async (example) => {
    const fixture = createFixture({
      outcome: 'selected',
      summary: 'Selected the exact affected repositories',
      data: example.selection,
      artifacts: [],
      evidence: [],
    })

    const result = await fixture.executor.execute(fixture.context())

    expect(result).toMatchObject({ status: 'succeeded', outcome: 'selected' })
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    const input = fixture.execute.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      runId: TEST_RUN_ID,
      nodeId: 'select-repositories',
      permissionProfile: 'read-only',
      declaredOutcomes: ['selected', 'blocked'],
      resourceBundleId: 'repository-selection-v1',
      workspace: {
        rootPath: join(fixture.candidateWorkspaceRoot, TEST_RUN_ID, 'candidates'),
        repositories: [
          { repositoryId: 'api', access: 'read-only' },
          { repositoryId: 'web', access: 'read-only' },
          { repositoryId: 'docs', access: 'read-only' },
        ],
      },
    })
    expect(input?.renderedPrompt).toContain('Untrusted: git checkout -- main')
    expect(input?.renderedPrompt).toContain('workflow-output/repository-selection-v1')
    for (const repository of input?.workspace.repositories ?? []) {
      expect(lstatSync(repository.path).isSymbolicLink()).toBe(true)
      expect(realpathSync(repository.path)).toBe(
        realpathSync(fixture.sourcePaths[repository.repositoryId] as string),
      )
    }
    const snapshot = fixture.persistence.runs.getRepositorySelection(TEST_RUN_ID)
    expect(snapshot?.selected).toEqual(example.selectedIds.map(selected))
    expect(snapshot?.excluded).toEqual(example.excludedIds.map(excluded))
    expect(fixture.persistence.runs.listWorkspaces(TEST_RUN_ID)).toEqual([])
    expect(
      fixture.persistence.events
        .list({ runId: TEST_RUN_ID, limit: 100 })
        .events.filter(({ type }) => type === 'NODE_OUTPUT')
        .map(({ data }) => data),
    ).toEqual([
      { channel: 'agent', content: 'Session identified: session-selection-01' },
      { channel: 'agent', content: 'Inspecting the explicit candidate catalog.' },
    ])
    for (const [repositoryId, path] of Object.entries(fixture.sourcePaths)) {
      expect(readFileSync(join(path, 'marker.txt'), 'utf8')).toBe(`unchanged:${repositoryId}\n`)
    }
  })

  it.each([
    {
      name: 'empty selection',
      selection: { selected: [], excluded: [excluded('api'), excluded('web'), excluded('docs')] },
    },
    {
      name: 'duplicate ID',
      selection: {
        selected: [selected('api'), selected('api')],
        excluded: [excluded('web'), excluded('docs')],
      },
    },
    {
      name: 'unknown ID',
      selection: {
        selected: [selected('unknown')],
        excluded: [excluded('api'), excluded('web'), excluded('docs')],
      },
    },
    {
      name: 'missing ID',
      selection: { selected: [selected('api')], excluded: [excluded('web')] },
    },
  ])('rejects an $name without persisting a partial partition', async ({ selection }) => {
    const fixture = createFixture({
      outcome: 'selected',
      summary: 'Returned an invalid partition',
      data: selection,
      artifacts: [],
      evidence: [],
    })

    const result = await fixture.executor.execute(fixture.context())

    expect(result).toEqual({
      status: 'failed',
      code: 'REPOSITORY_SELECTION_INVALID',
      message: 'Repository selection is invalid',
    })
    expect(fixture.persistence.runs.getRepositorySelection(TEST_RUN_ID)).toBeUndefined()
    expect(fixture.persistence.runs.listSelections(TEST_RUN_ID)).toEqual([])
  })

  it('keeps the first valid selection immutable without starting another agent session', async () => {
    const fixture = createFixture({
      outcome: 'selected',
      summary: 'Selected API',
      data: {
        selected: [selected('api')],
        excluded: [excluded('web'), excluded('docs')],
      },
      artifacts: [],
      evidence: [],
    })
    await fixture.executor.execute(fixture.context())

    const second = await fixture.executor.execute(fixture.context())

    expect(second).toEqual({
      status: 'failed',
      code: 'REPOSITORY_SELECTION_IMMUTABLE',
      message: 'Repository selection is already recorded',
    })
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(
      fixture.persistence.runs
        .getRepositorySelection(TEST_RUN_ID)
        ?.selected.map(({ repositoryId }) => repositoryId),
    ).toEqual(['api'])
  })

  it('routes a blocked result without recording a repository selection', async () => {
    const fixture = createFixture({
      outcome: 'blocked',
      summary: 'The task does not contain enough repository evidence',
      data: { reason: 'ambiguous ownership' },
      artifacts: [],
      evidence: [],
    })

    const result = await fixture.executor.execute(fixture.context())

    expect(result).toEqual({
      status: 'succeeded',
      outcome: 'blocked',
      artifactIds: [],
      output: { summary: 'The task does not contain enough repository evidence' },
    })
    expect(fixture.persistence.runs.getRepositorySelection(TEST_RUN_ID)).toBeUndefined()
  })
})
