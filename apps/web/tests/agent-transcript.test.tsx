// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NodeIdSchema, RunIdSchema, type RunEvent } from '@loop/contracts'
import type { AgentNode } from '@loop/workflow-model'

import { AgentTranscript } from '../components/runs/agent-transcript'

const node: AgentNode = {
  type: 'agent',
  id: NodeIdSchema.parse('implement'),
  name: 'Implement change',
  description: 'Implement the requested change.',
  timeoutSeconds: 900,
  result: { schemaRef: 'json:any-v1' },
  sandbox: { profileId: 'agent-default-v1', imageId: 'gondolin-alpine-v1' },
  job: {
    kind: 'agent',
    prompt: 'Implement the requested change.',
    skillSnapshotRefs: [],
    inference: {
      connectionId: 'test-provider',
      modelId: 'test-model',
      thinkingLevel: 'high',
    },
    connectorIds: [],
  },
}

const outputEvent = (sequence: number, content: string): RunEvent => ({
  type: 'NODE_OUTPUT',
  runId: RunIdSchema.parse('run-01'),
  nodeId: node.id,
  sequence,
  timestamp: `2026-08-18T12:00:0${sequence}Z`,
  data: { channel: 'agent', content },
})

afterEach(cleanup)

describe('AgentTranscript', () => {
  it('renders captured tool lifecycle entries alongside reasoning and response messages', () => {
    render(
      <AgentTranscript
        node={node}
        result={undefined}
        streaming={false}
        events={[
          outputEvent(1, 'Tool started: read_file (tool-01)'),
          outputEvent(2, 'Tool update (tool-01): Reading apps/web/app/page.tsx'),
          outputEvent(3, 'Tool succeeded: read_file (tool-01)\nRead 42 lines'),
        ]}
      />,
    )

    expect(screen.getByText('read_file')).toBeTruthy()
    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Reading apps/web/app/page.tsx')).toBeTruthy()
    expect(screen.getByText('Read 42 lines')).toBeTruthy()
  })

  it('does not treat legacy finalization artifacts as agent messages', () => {
    render(
      <AgentTranscript
        node={node}
        streaming={false}
        events={[]}
        result={{
          artifacts: [{ type: 'FINALIZATION', content: 'Legacy finalization response' }],
        }}
      />,
    )

    expect(screen.queryByText('Legacy finalization response')).toBeNull()
    expect(screen.getByText('No response was recorded.')).toBeTruthy()
  })
})
