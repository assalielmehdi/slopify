import type { Workflow } from '@slopify/workflow-model'
import { describe, expect, it, vi } from 'vitest'

import {
  RunDomainEventSchema,
  createJournalExecutionWorker,
  createJournalWorkflowCoordinator,
  createRunProjectionState,
  createRunRecoveryService,
  reduceRunEvents,
  type JournalRunLocator,
  type NewRunDomainEvent,
  type RunDomainEvent,
  type RunJournal,
} from '../../src/index.js'

const timestamp = '2026-08-25T10:00:00.000Z'
const workflow: Workflow = {
  schemaVersion: 2,
  workflowId: 'recovery-review',
  name: 'Recovery review',
  description: 'Exercise conservative startup recovery.',
  configuration: { repositoryIds: [], primaryRepositoryId: null, variables: [] },
  startNodeId: 'review',
  nodes: [
    {
      type: 'agent',
      id: 'review',
      name: 'Review',
      prompt: 'Review the change.',
      harness: { harnessId: 'pi' },
    },
  ],
  edges: [],
  maxTransitions: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
}

const createRun = (runId: string) => {
  const events: RunDomainEvent[] = []
  const initial = createRunProjectionState({
    run: {
      schemaVersion: 1,
      runId,
      workflowId: workflow.workflowId,
      status: 'PENDING',
      transitionCount: 0,
      lastEventSequence: 0,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      failureCode: null,
    },
    workspaces: { schemaVersion: 1, runId, lastEventSequence: 0, workspaces: [] },
  })
  let repairs = 0
  const journal: RunJournal = {
    async append(input: NewRunDomainEvent) {
      const existing = events.find(({ eventId }) => eventId === input.eventId)
      if (existing !== undefined) return existing
      const event = RunDomainEventSchema.parse({
        ...input,
        schemaVersion: 1,
        runId,
        sequence: events.length + 1,
      })
      events.push(event)
      return event
    },
    async replay() {
      return { status: 'READY', events: structuredClone(events), recoveredBytes: 0 }
    },
    async repairProjections() {
      repairs += 1
      return {
        status: 'READY',
        events: structuredClone(events),
        recoveredBytes: 0,
        projection: reduceRunEvents(initial, events),
        repaired: true,
      }
    },
  }
  return {
    events,
    journal,
    projection: () => reduceRunEvents(initial, events),
    repairs: () => repairs,
  }
}

describe('run recovery service', () => {
  it('resumes admitted and pending work but fails prior-process attempts without rerunning them', async () => {
    const admitted = createRun('run-admitted')
    const pending = createRun('run-pending')
    const interrupted = createRun('run-interrupted')
    const cancelled = createRun('run-cancelled')
    const entries = new Map([
      ['run-admitted', admitted],
      ['run-pending', pending],
      ['run-interrupted', interrupted],
      ['run-cancelled', cancelled],
    ])
    const admittedLocator = { workflowId: workflow.workflowId, runId: 'run-admitted' }
    const pendingLocator = { workflowId: workflow.workflowId, runId: 'run-pending' }
    const interruptedLocator = { workflowId: workflow.workflowId, runId: 'run-interrupted' }
    const cancelledLocator = { workflowId: workflow.workflowId, runId: 'run-cancelled' }
    const locators: JournalRunLocator[] = [
      admittedLocator,
      pendingLocator,
      interruptedLocator,
      cancelledLocator,
    ]
    const runs = {
      async list() {
        return locators
      },
      async load({ runId }: JournalRunLocator) {
        const entry = entries.get(runId)
        return entry === undefined ? undefined : { workflow, journal: entry.journal }
      },
    }
    const coordinator = createJournalWorkflowCoordinator({ runs, now: () => timestamp })
    await coordinator.start(pendingLocator)
    await coordinator.start(interruptedLocator)
    await coordinator.start(cancelledLocator)
    for (const entry of [interrupted, cancelled]) {
      const execution = entry.projection().executions[0]
      if (execution === undefined) throw new Error('Scheduled execution was not found')
      await entry.journal.append({
        eventId: `started-${execution.attemptId}`,
        timestamp,
        type: 'NODE_STARTED',
        data: {
          nodeExecutionId: execution.nodeExecutionId,
          attemptId: execution.attemptId,
        },
      })
    }
    await coordinator.requestCancellation({ ...cancelledLocator, reason: 'Stopped before restart' })
    const executedRunIds: string[] = []
    const worker = createJournalExecutionWorker({
      runs,
      coordinator,
      runner: {
        async run(input) {
          executedRunIds.push(input.runId)
          return { status: 'succeeded', outcome: 'completed', output: {} }
        },
        async cancel() {
          return { status: 'cancelled' }
        },
      },
      now: () => timestamp,
    })
    const recovery = createRunRecoveryService({
      runs,
      coordinator,
      worker,
      now: () => timestamp,
    })

    await expect(recovery.recover()).resolves.toMatchObject({
      scannedRuns: 4,
      resumedExecutions: 2,
      interruptedExecutions: 2,
    })
    expect(executedRunIds.sort()).toEqual(['run-admitted', 'run-pending'])
    expect(interrupted.projection().run).toMatchObject({
      status: 'FAILED',
      failureCode: 'HOST_PROCESS_INTERRUPTED',
    })
    expect(cancelled.projection().run.status).toBe('CANCELLED')
    for (const entry of [interrupted, cancelled]) {
      expect(entry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'NODE_FAILED',
            data: expect.objectContaining({ code: 'HOST_PROCESS_INTERRUPTED' }),
          }),
        ]),
      )
    }
    expect(admitted.repairs()).toBeGreaterThan(0)
    expect(pending.repairs()).toBeGreaterThan(0)

    await expect(recovery.recover()).resolves.toMatchObject({
      resumedExecutions: 0,
      interruptedExecutions: 0,
    })
    expect(executedRunIds.sort()).toEqual(['run-admitted', 'run-pending'])
    expect(
      interrupted.events.filter(
        (event) => event.type === 'NODE_FAILED' && event.data.code === 'HOST_PROCESS_INTERRUPTED',
      ),
    ).toHaveLength(1)
  })

  it('repairs terminal projections and journals workspace cleanup', async () => {
    const terminal = createRun('run-terminal')
    await terminal.journal.append({
      eventId: 'workspace-preparing',
      timestamp,
      type: 'WORKSPACE_PREPARING',
      data: {
        repositoryId: 'repository-01',
        position: 0,
        workspacePath: '/tmp/slopify/run-terminal/repository-01',
        branchName: 'slopify/run-terminal',
      },
    })
    await terminal.journal.append({
      eventId: 'workspace-ready',
      timestamp,
      type: 'WORKSPACE_READY',
      data: { repositoryId: 'repository-01' },
    })
    await terminal.journal.append({
      eventId: 'run-started',
      timestamp,
      type: 'RUN_STARTED',
      data: {},
    })
    await terminal.journal.append({
      eventId: 'run-succeeded',
      timestamp,
      type: 'RUN_SUCCEEDED',
      data: {},
    })
    const locator = { workflowId: workflow.workflowId, runId: 'run-terminal' }
    const runs = {
      async list() {
        return [locator]
      },
      async load() {
        return { workflow, journal: terminal.journal }
      },
    }
    const cleanup = vi.fn(async () => ['repository-01'] as const)
    const coordinator = createJournalWorkflowCoordinator({ runs, now: () => timestamp })
    const recovery = createRunRecoveryService({
      runs,
      coordinator,
      worker: { drain: vi.fn(async () => 0) },
      workspaces: { cleanup },
      now: () => timestamp,
    })

    await expect(recovery.recover()).resolves.toMatchObject({
      scannedRuns: 1,
      cleanedWorkspaces: 1,
    })
    expect(cleanup).toHaveBeenCalledWith({
      run: locator,
      workspaces: [expect.objectContaining({ repositoryId: 'repository-01', status: 'READY' })],
    })
    expect(terminal.events.at(-1)).toMatchObject({
      type: 'WORKSPACE_CLEANED',
      data: { repositoryId: 'repository-01' },
    })
    expect(terminal.projection().workspaces.workspaces[0]?.status).toBe('CLEANED')

    await recovery.recover()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(terminal.events.filter(({ type }) => type === 'WORKSPACE_CLEANED')).toHaveLength(1)
  })
})
