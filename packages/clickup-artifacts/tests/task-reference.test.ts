import { describe, expect, it } from 'vitest'

import { ClickUpTaskReferenceError, normalizeClickUpTaskReference } from '../src/index.js'

describe('ClickUp task reference normalization', () => {
  it.each([
    ['86abc123', 'https://app.clickup.com/t/86abc123'],
    ['PROJ-42', 'https://app.clickup.com/t/PROJ-42'],
  ])('normalizes task ID %j and its URL to the same identity', (taskId, taskUrl) => {
    expect(normalizeClickUpTaskReference(taskId)).toEqual(
      normalizeClickUpTaskReference(`${taskUrl}/?view=detail#activity`),
    )
    expect(normalizeClickUpTaskReference(taskId)).toEqual({
      taskId,
      kind: taskId.includes('-') ? 'custom' : 'native',
      canonicalUrl: taskUrl,
    })
  })

  it.each([
    '',
    '   ',
    'task with spaces',
    'https://clickup.com/t/86abc123',
    'http://app.clickup.com/t/86abc123',
    'https://user@app.clickup.com/t/86abc123',
    'https://app.clickup.com.evil.example/t/86abc123',
    'https://app.clickup.com/v/li/123?pr=86abc123',
    'https://app.clickup.com/t/',
    'https://app.clickup.com/t/86abc123/extra',
    'https://app.clickup.com/t/86abc%2F123',
    `a${'b'.repeat(128)}`,
  ])('rejects unsupported or ambiguous reference %j', (reference) => {
    expect(() => normalizeClickUpTaskReference(reference)).toThrowError(
      expect.objectContaining({ code: 'TASK_REFERENCE_INVALID' }),
    )
    expect(() => normalizeClickUpTaskReference(reference)).toThrow(ClickUpTaskReferenceError)
  })
})
