'use client'

import { PlusIcon, SearchIcon } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function CatalogToolbar({
  children,
  onAdd,
  onQueryChange,
  plural,
  query,
  singular,
}: Readonly<{
  children?: ReactNode
  onAdd: () => void
  onQueryChange: (query: string) => void
  plural: string
  query: string
  singular: string
}>) {
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchOpen = searchExpanded || query !== ''

  return (
    <div className="mb-3 flex justify-end gap-2">
      <div
        role="search"
        className={cn(
          't-resize group/search flex h-8 items-center overflow-hidden rounded-md bg-background [--resize-dur:var(--duration-very-slow)]',
          searchOpen ? 'w-60' : 'w-8 hover:w-60 focus-within:w-60',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${singular} search`}
          aria-expanded={searchOpen}
          className="size-8 shrink-0 border-0"
          onClick={() => {
            setSearchExpanded(true)
            searchInputRef.current?.focus()
          }}
        >
          <SearchIcon aria-hidden="true" />
        </Button>
        <Input
          ref={searchInputRef}
          type="search"
          aria-label={`Search ${plural}`}
          autoComplete="off"
          placeholder={`Search ${plural}`}
          tabIndex={searchOpen ? 0 : -1}
          value={query}
          onBlur={() => {
            if (query === '') setSearchExpanded(false)
          }}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          className={cn(
            'h-8 w-52 shrink-0 border-0 bg-transparent px-1 shadow-none transition-opacity duration-[var(--resize-dur)] ease-[var(--resize-ease)] focus-visible:border-0 dark:bg-transparent',
            searchOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover/search:opacity-100 group-focus-within/search:opacity-100',
          )}
        />
      </div>
      {children}
      <Button
        type="button"
        size="icon-sm"
        aria-label={`Add ${singular}`}
        onClick={onAdd}
        className="t-resize t-resize-intrinsic group/add w-8 justify-start gap-2 overflow-hidden px-2 [--resize-dur:var(--duration-very-slow)] hover:w-max focus:w-max"
      >
        <PlusIcon aria-hidden="true" className="shrink-0" />
        <span className="shrink-0 opacity-0 transition-opacity duration-[var(--resize-dur)] ease-[var(--resize-ease)] group-hover/add:opacity-100 group-focus/add:opacity-100">
          Add {singular}
        </span>
      </Button>
    </div>
  )
}
