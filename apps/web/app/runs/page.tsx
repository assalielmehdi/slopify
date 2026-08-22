import type { Metadata } from 'next'
import { RunStatusSchema } from '@slopify/contracts'

import { emptyRunFilters, type RunFilters } from '@/components/runs/run-filters'
import { RunHistory } from '@/components/runs/run-history'

export const metadata: Metadata = {
  title: 'Runs',
}

export default async function RunsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const parameters = await searchParams
  const rawPage = parameters.page
  const parsedPage = typeof rawPage === 'string' ? Number(rawPage) : Number.NaN
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const single = (key: string): string => {
    const value = parameters[key]
    return typeof value === 'string' ? value : ''
  }
  const date = (key: string): string => {
    const value = single(key)
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      ? value
      : ''
  }
  const seconds = (key: string): string => {
    const value = single(key)
    const parsed = Number(value)
    return value !== '' && Number.isFinite(parsed) && parsed >= 0 ? value : ''
  }
  const rawStatuses = parameters.status
  const statusValues = Array.isArray(rawStatuses)
    ? rawStatuses
    : typeof rawStatuses === 'string'
      ? [rawStatuses]
      : []
  const filters: RunFilters = {
    ...emptyRunFilters,
    runId: single('runId'),
    statuses: [
      ...new Set(
        statusValues.flatMap((status) => {
          const parsed = RunStatusSchema.safeParse(status)
          return parsed.success ? [parsed.data] : []
        }),
      ),
    ],
    startedFrom: date('startedFrom'),
    startedTo: date('startedTo'),
    durationMinSeconds: seconds('durationMinSeconds'),
    durationMaxSeconds: seconds('durationMaxSeconds'),
  }

  return <RunHistory initialFilters={filters} page={page} />
}
