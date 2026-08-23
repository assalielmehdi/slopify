// @vitest-environment jsdom

import { waitFor } from '@testing-library/react'
import { DeletionReceiptSchema } from '@slopify/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { toast } from '../lib/toast'
import { showUndoDeletionToast } from '../lib/undo-deletion-toast'

const receipt = () =>
  DeletionReceiptSchema.parse({
    deletionId: 'deletion-01' as const,
    subject: { type: 'PROJECT' as const, id: 'project-01' as const },
    deletedAt: new Date().toISOString(),
    undoExpiresAt: new Date(Date.now() + 10_000).toISOString(),
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('undo deletion toast', () => {
  it('closes the deletion toast before adding the restored toast', async () => {
    const onUndo = vi.fn(async () => undefined)
    const add = vi.spyOn(toast, 'add').mockReturnValue('toast-01')
    const close = vi.spyOn(toast, 'close')

    showUndoDeletionToast({
      receipt: receipt(),
      deletedTitle: 'Project deleted',
      deletedDescription: 'Project was removed.',
      restoredTitle: 'Project restored',
      restoredDescription: 'Project is available again.',
      onUndo,
    })
    const options = add.mock.calls[0]?.[0]
    options?.actionProps?.onClick?.({} as never)

    await waitFor(() => expect(onUndo).toHaveBeenCalledOnce())
    expect(close).toHaveBeenCalledWith('toast-01')
    expect(add).toHaveBeenCalledTimes(1)

    options?.onRemove?.()

    await waitFor(() =>
      expect(add).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Project restored', type: 'success' }),
      ),
    )
  })

  it('removes the action when the server reports that undo expired', async () => {
    const add = vi.spyOn(toast, 'add').mockReturnValue('toast-01')
    vi.spyOn(toast, 'close')

    showUndoDeletionToast({
      receipt: receipt(),
      deletedTitle: 'Project deleted',
      deletedDescription: 'Project was removed.',
      restoredTitle: 'Project restored',
      restoredDescription: 'Project is available again.',
      onUndo: async () => Promise.reject({ code: 'DELETION_UNDO_EXPIRED' }),
    })
    const options = add.mock.calls[0]?.[0]
    options?.actionProps?.onClick?.({} as never)
    options?.onRemove?.()

    await waitFor(() =>
      expect(add).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: 'Undo window expired',
          type: 'error',
        }),
      ),
    )
  })
})
