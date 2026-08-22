import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm/5 transition-[color,background-color,border-color] duration-[var(--duration-quick)] outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive dark:bg-input/20 dark:disabled:bg-input/50 dark:aria-invalid:border-destructive/50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
