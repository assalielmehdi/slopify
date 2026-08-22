import { Skeleton } from '@/components/ui/skeleton'

export function CatalogCardSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          data-testid="catalog-card-skeleton"
          className="flex h-[140px] items-start gap-3.5 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-raised)]"
          aria-hidden="true"
        >
          <Skeleton className="size-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-24" />
            <div className="space-y-2 pt-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
