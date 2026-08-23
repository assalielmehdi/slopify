// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentTraceSchema } from '@slopify/contracts'
import { AgentNodeSchema } from '@slopify/workflow-model'

import { RunNodePanel } from '../components/runs/run-node-panel'

const node = AgentNodeSchema.parse({
  type: 'agent',
  id: 'identify-agent',
  name: 'Alpha analyst',
  prompt: 'Analyze {{ topic }}.',
  harness: {
    harnessId: 'pi',
    modelId: 'openai/gpt-5.4',
    thinkingLevel: 'high',
  },
})

const trace = AgentTraceSchema.parse({
  header: {
    version: 1,
    runId: 'run-01',
    nodeExecutionId: 'node-execution-01',
    attemptId: 'attempt-01',
    nodeId: 'identify-agent',
    createdAt: '2026-08-22T10:00:00.000Z',
    configuration: {
      harnessId: 'pi',
      harnessVersion: '0.84.2',
      model: 'openai/gpt-5.4',
      thinkingLevel: 'high',
      renderedPrompt: 'Analyze launch readiness.',
      workspaceRoot: '/Users/developer/.slopify/orchestrator/worktrees/run-01/project-api',
      primaryProjectId: 'project-api',
      projects: [
        {
          projectId: 'project-api',
          name: 'API',
          worktreePath: '/Users/developer/.slopify/orchestrator/worktrees/run-01/project-api',
          baseSha: 'a'.repeat(40),
          sourceBranch: 'main',
        },
        {
          projectId: 'project-web',
          name: 'Web',
          worktreePath: '/Users/developer/.slopify/orchestrator/worktrees/run-01/project-web',
          baseSha: 'b'.repeat(40),
          sourceBranch: null,
        },
      ],
      timeoutSeconds: 300,
    },
  },
  events: [],
  complete: true,
})

afterEach(cleanup)

describe('RunNodePanel', () => {
  it('shows captured harness and isolated run worktrees', () => {
    render(
      <RunNodePanel
        execution={{
          attemptId: 'attempt-01',
          completedAt: '2026-08-22T10:00:12.500Z',
          durationMs: 12_500,
          errorCode: null,
          errorMessage: null,
          outcome: 'completed',
          output: undefined,
          startedAt: '2026-08-22T10:00:00.000Z',
          nodeExecutionId: 'node-execution-01',
        }}
        node={node}
        status="SUCCEEDED"
        trace={trace}
        traceError={undefined}
        traceLoading={false}
      />,
    )

    expect(screen.queryByText('Outcome')).toBeNull()
    expect(screen.queryByText('Execution ID')).toBeNull()

    const configuration = screen.getByLabelText('Configuration')
    expect(screen.queryByRole('heading', { name: 'Configuration' })).toBeNull()
    expect(configuration.textContent).toContain('Harness')
    expect(configuration.textContent).toContain('Pi')
    expect(configuration.textContent).toContain('Version')
    expect(configuration.textContent).toContain('0.84.2')
    expect(configuration.textContent).toContain('Model')
    expect(configuration.textContent).toContain('openai/gpt-5.4')
    expect(configuration.textContent).toContain('Thinking')
    expect(configuration.textContent).toContain('high')
    const worktrees = screen.getByRole('region', { name: 'Run worktrees' })
    expect(worktrees.textContent).toContain('API')
    expect(worktrees.textContent).toContain('Primary')
    expect(worktrees.textContent).toContain(
      '/Users/developer/.slopify/orchestrator/worktrees/run-01/project-api',
    )
    expect(worktrees.textContent).toContain('Web')
    expect(worktrees.textContent).toContain('Detached')
    expect(screen.queryByRole('heading', { name: 'Exchange' })).toBeNull()
    expect(
      screen.queryByText('Complete recorded prompt, model output, reasoning, and tool activity.'),
    ).toBeNull()
    expect(screen.getByRole('separator')).toBeTruthy()

    const transcript = document.querySelector('[data-slot="message-scroller"]')
    expect(transcript?.className).not.toContain('border')
    expect(transcript?.className).not.toContain('rounded')
  })
})
