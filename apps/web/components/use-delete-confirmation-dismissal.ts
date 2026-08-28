'use client'

import { useEffect, type RefObject } from 'react'

export function useDeleteConfirmationDismissal({
  actionRef,
  active,
  confirmationRef,
  disabled = false,
  onDismiss,
}: Readonly<{
  actionRef?: RefObject<HTMLElement | null> | undefined
  active: boolean
  confirmationRef: RefObject<HTMLElement | null>
  disabled?: boolean | undefined
  onDismiss: () => void
}>) {
  useEffect(() => {
    if (!active || disabled) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (confirmationRef.current?.contains(target) || actionRef?.current?.contains(target)) return
      onDismiss()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionRef, active, confirmationRef, disabled, onDismiss])
}
