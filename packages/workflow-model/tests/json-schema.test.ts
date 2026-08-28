import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

import { createWorkflowFileJsonSchema } from '../src/index.js'

const workflowFile = {
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
      },
    ],
    edges: [],
    maxTransitions: 24,
  },
  createdAt: '2026-08-18T20:00:00Z',
  updatedAt: '2026-08-18T21:00:00Z',
} as const

describe('workflow JSON Schema', () => {
  it('generates a deterministic Draft 2020-12 document', () => {
    const first = createWorkflowFileJsonSchema()
    const second = createWorkflowFileJsonSchema()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.slopify.local/workflow.v3.schema.json',
      title: 'Slopify workflow v3',
      type: 'object',
      additionalProperties: false,
    })
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  it('matches runtime structural validation fixtures', () => {
    const ajv = new Ajv2020({ strict: true })
    addFormats(ajv)
    const validate = ajv.compile(createWorkflowFileJsonSchema())

    expect(validate(workflowFile)).toBe(true)
    expect(
      validate({
        ...workflowFile,
        graph: {
          ...workflowFile.graph,
          nodes: [{ ...workflowFile.graph.nodes[0], timeoutSeconds: 1_200 }],
        },
      }),
    ).toBe(true)
    expect(
      validate({
        ...workflowFile,
        graph: {
          ...workflowFile.graph,
          nodes: [{ ...workflowFile.graph.nodes[0], timeoutSeconds: 61 }],
        },
      }),
    ).toBe(false)
    expect(validate({ ...workflowFile, name: 'Release review' })).toBe(false)
    expect(validate({ ...workflowFile, workflowId: 'Release_review' })).toBe(false)
    expect(validate({ ...workflowFile, unexpected: true })).toBe(false)
    expect(
      validate({
        ...workflowFile,
        graph: { ...workflowFile.graph, maxTransitions: -1 },
      }),
    ).toBe(false)
  })
})
