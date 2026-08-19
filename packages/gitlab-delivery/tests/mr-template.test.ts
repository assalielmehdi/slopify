import { describe, expect, it } from 'vitest'

import { renderMergeRequestTemplate } from '../src/index.js'

describe('versioned merge request template', () => {
  it('renders the approved task, change, check, risk, and rollback sections', () => {
    const result = renderMergeRequestTemplate({
      task: {
        taskId: 'CU-123',
        title: 'Reject invalid API requests',
        url: 'https://app.clickup.com/t/CU-123',
      },
      repository: {
        repositoryId: 'api',
        displayName: 'API',
        sourceBranch: 'ai/cu-123-run-01',
        targetBranch: 'main',
      },
      summary: 'Reject malformed request bodies with a stable validation response.',
      changes: [
        'Added request-boundary validation.',
        'Preserved existing successful response behavior.',
      ],
      verification: ['pnpm test — passed', 'pnpm typecheck — passed'],
      risks: ['Clients relying on the malformed response now receive HTTP 422.'],
      rollback: 'Revert the commits on `ai/cu-123-run-01`.',
    })

    expect(result).toEqual({
      templateVersion: 'merge-request-v1',
      title: '[CU-123] Reject invalid API requests',
      body: [
        '## Task',
        '',
        '[CU-123 — Reject invalid API requests](https://app.clickup.com/t/CU-123)',
        '',
        '## Summary',
        '',
        'Reject malformed request bodies with a stable validation response.',
        '',
        '## Changes',
        '',
        '- Added request-boundary validation.',
        '- Preserved existing successful response behavior.',
        '',
        '## Verification',
        '',
        '- pnpm test — passed',
        '- pnpm typecheck — passed',
        '',
        '## Risks',
        '',
        '- Clients relying on the malformed response now receive HTTP 422.',
        '',
        '## Rollback',
        '',
        'Revert the commits on `ai/cu-123-run-01`.',
      ].join('\n'),
    })
  })

  it('uses an explicit no-known-risks statement instead of omitting the section', () => {
    const result = renderMergeRequestTemplate({
      task: {
        taskId: 'CU-123',
        title: 'Update docs',
        url: 'https://app.clickup.com/t/CU-123',
      },
      repository: {
        repositoryId: 'docs',
        displayName: 'Documentation',
        sourceBranch: 'ai/cu-123-run-01',
        targetBranch: 'main',
      },
      summary: 'Document the validation response.',
      changes: ['Added response examples.'],
      verification: ['pnpm lint — passed'],
      risks: [],
      rollback: 'Revert the documentation commit.',
    })

    expect(result.body).toContain('## Risks\n\n- No known risks.')
    expect(result.body).toContain('## Rollback\n\nRevert the documentation commit.')
  })
})
