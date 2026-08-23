import type { DeletionReceipt } from '@slopify/contracts'

import { toast } from '@/lib/toast'

interface UndoDeletionToastOptions {
  readonly receipt: Pick<DeletionReceipt, 'undoExpiresAt'>
  readonly deletedTitle: string
  readonly deletedDescription: string
  readonly restoredTitle: string
  readonly restoredDescription: string
  readonly onUndo: () => Promise<void>
}

const remainingTime = (receipt: Pick<DeletionReceipt, 'undoExpiresAt'>): number =>
  Math.max(0, Date.parse(receipt.undoExpiresAt) - Date.now())

const errorCode = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : undefined

export const showUndoDeletionToast = (options: UndoDeletionToastOptions): string => {
  const showResult = (result: Readonly<{ ok: true } | { ok: false; cause: unknown }>) => {
    if (result.ok) {
      toast.add({
        title: options.restoredTitle,
        description: options.restoredDescription,
        type: 'success',
        timeout: 5_000,
      })
      return
    }

    const timeout = remainingTime(options.receipt)
    if (errorCode(result.cause) === 'DELETION_UNDO_EXPIRED' || timeout === 0) {
      toast.add({
        title: 'Undo window expired',
        description: 'The deletion could not be restored.',
        type: 'error',
        timeout: 5_000,
      })
      return
    }
    addUndoToast({
      title: 'Could not undo deletion',
      description: 'Try again before the undo window expires.',
      type: 'error',
      actionLabel: 'Retry undo',
      timeout,
    })
  }

  const addUndoToast = (
    input: Readonly<{
      title: string
      description: string
      type: 'info' | 'error'
      actionLabel: string
      timeout: number
    }>,
  ): string => {
    let resolveRemoved: () => void = () => undefined
    const removed = new Promise<void>((resolve) => {
      resolveRemoved = resolve
    })
    let pending = false
    let toastId = ''
    const undo = () => {
      if (pending) return
      pending = true
      const result = options.onUndo().then(
        () => ({ ok: true }) as const,
        (cause: unknown) => ({ ok: false, cause }) as const,
      )
      toast.close(toastId)
      void Promise.all([result, removed]).then(([outcome]) => showResult(outcome))
    }
    toastId = toast.add({
      title: input.title,
      description: input.description,
      type: input.type,
      timeout: input.timeout,
      onRemove: resolveRemoved,
      actionProps: { children: input.actionLabel, onClick: undo },
    })
    return toastId
  }

  const timeout = remainingTime(options.receipt)
  return timeout === 0
    ? toast.add({
        title: options.deletedTitle,
        description: options.deletedDescription,
        type: 'info',
        timeout: 5_000,
      })
    : addUndoToast({
        title: options.deletedTitle,
        description: options.deletedDescription,
        type: 'info',
        actionLabel: 'Undo',
        timeout,
      })
}
