import { describe, expect, it, vi } from 'vitest'

import { DeletionServiceError, createDeletionService } from '../../src/index.js'

const operation = {
  deletionId: 'deletion-01',
  subject: { type: 'PROJECT' as const, id: 'project-01' },
  deletedAt: '2026-08-22T10:00:00Z',
  undoExpiresAt: '2026-08-22T10:00:10Z',
  state: 'PENDING' as const,
}

describe('deletion service', () => {
  it('routes undo to the handler selected by the persisted subject type', async () => {
    const undoDeletion = vi.fn(async () => 'UNDONE' as const)
    const service = createDeletionService({
      operations: { get: () => operation },
      handlers: [{ subjectType: 'PROJECT', undoDeletion }],
    })

    await expect(service.undo('deletion-01')).resolves.toEqual({
      ...operation,
      state: 'UNDONE',
    })
    expect(undoDeletion).toHaveBeenCalledWith('deletion-01')
  })

  it.each([
    ['missing', undefined, 'DELETION_NOT_FOUND'],
    ['purged', { ...operation, state: 'PURGED' as const }, 'DELETION_UNDO_EXPIRED'],
  ])('returns a stable error for a %s operation', async (_name, stored, code) => {
    const service = createDeletionService({
      operations: { get: () => stored },
      handlers: [],
    })

    await expect(service.undo('deletion-01')).rejects.toEqual(
      expect.objectContaining<Partial<DeletionServiceError>>({ code }),
    )
  })
})
