import { describe, expect, it, vi } from 'vitest'

import { createPredefinedV1Revision } from '@loop/workflow-model'

import {
  createWorkflowService,
  type SkillCatalog,
  type SkillRecord,
  type SkillSnapshotStore,
  type WorkflowRepository,
} from '../../src/index.js'

const SKILL: SkillRecord = {
  skillId: 'gitlab-delivery',
  name: 'gitlab-delivery',
  description: 'Use GitLab safely',
  digest: 'a'.repeat(64),
  modifiedAt: '2026-08-20T00:00:00.000Z',
  valid: true,
  issues: [],
  files: [
    { path: 'SKILL.md', content: 'instructions', size: 12 },
    { path: 'scripts/check.sh', content: '#!/bin/sh', size: 9 },
  ],
}

const createFixture = () => {
  const parent = createPredefinedV1Revision({
    revisionId: 'revision-01',
    createdAt: '2026-08-20T00:00:00.000Z',
    agentDefaults: { provider: 'openrouter', model: 'openai/gpt-5.4', thinkingLevel: 'medium' },
  })
  const records = [parent]
  const workflows: WorkflowRepository = {
    addRevision: vi.fn((revision) => records.unshift(revision)),
    getRevision: ({ workflowId, revisionId }) =>
      records.find(
        (revision) => revision.workflowId === workflowId && revision.revisionId === revisionId,
      ),
    listRevisions: () => records,
  }
  const skills: SkillCatalog = {
    refresh: vi.fn(),
    get: vi.fn(async (skillId) => {
      if (skillId !== SKILL.skillId) throw new Error('missing')
      return SKILL
    }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
  const skillSnapshots: SkillSnapshotStore = {
    capture: vi.fn(async (skill) => ({
      snapshotId: `sha256:${skill.digest}`,
      skillId: skill.skillId,
      name: skill.name,
      description: skill.description,
      digest: skill.digest,
      path: `/snapshots/${skill.digest}`,
    })),
    get: vi.fn(),
  }
  const service = createWorkflowService({ workflows, skills, skillSnapshots })
  return { parent, service, skills, skillSnapshots }
}

describe('workflow skill publication', () => {
  it('captures complete live skills and persists only immutable references', async () => {
    const { parent, service, skillSnapshots } = createFixture()
    const revision = await service.create(parent.workflowId, {
      parentRevisionId: parent.revisionId,
      revisionId: 'revision-02',
      updates: [{ nodeId: 'identify-agent', changes: { skillIds: ['gitlab-delivery'] } }],
    })

    expect(skillSnapshots.capture).toHaveBeenCalledWith(SKILL)
    expect(revision.nodes.find(({ id }) => id === 'identify-agent')).toMatchObject({
      job: {
        skillSnapshotRefs: [
          {
            snapshotId: `sha256:${'a'.repeat(64)}`,
            skillId: 'gitlab-delivery',
            name: 'gitlab-delivery',
            description: 'Use GitLab safely',
            digest: 'a'.repeat(64),
          },
        ],
      },
    })
    expect(JSON.stringify(revision)).not.toContain('/snapshots/')
  })

  it('does not consult the mutable catalog when reading a published revision', async () => {
    const { parent, service, skills } = createFixture()
    const revision = await service.create(parent.workflowId, {
      parentRevisionId: parent.revisionId,
      revisionId: 'revision-02',
      updates: [{ nodeId: 'identify-agent', changes: { skillIds: ['gitlab-delivery'] } }],
    })
    vi.mocked(skills.get).mockRejectedValue(new Error('deleted'))

    expect(service.get(parent.workflowId, revision.revisionId)).toEqual(revision)
    expect(skills.get).toHaveBeenCalledTimes(1)
  })
})
