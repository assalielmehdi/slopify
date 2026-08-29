import type { ReactNode } from 'react'

export function CatalogCardTags({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <span
      data-slot="catalog-card-tags"
      className="mt-auto flex min-h-5 flex-wrap items-center justify-end gap-1.5 pt-2"
    >
      {children}
    </span>
  )
}
