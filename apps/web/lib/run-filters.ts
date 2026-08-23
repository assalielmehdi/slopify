import type { RunStatus } from '@slopify/contracts'

export interface RunFilters {
  readonly runId: string
  readonly statuses: readonly RunStatus[]
  readonly startedFrom: string
  readonly startedTo: string
  readonly durationMinSeconds: string
  readonly durationMaxSeconds: string
}

export const emptyRunFilters: RunFilters = {
  runId: '',
  statuses: [],
  startedFrom: '',
  startedTo: '',
  durationMinSeconds: '',
  durationMaxSeconds: '',
}

export const activeRunFilterCount = (filters: RunFilters): number =>
  Number(filters.runId.trim() !== '') +
  Number(filters.statuses.length > 0) +
  Number(filters.startedFrom !== '' || filters.startedTo !== '') +
  Number(filters.durationMinSeconds !== '' || filters.durationMaxSeconds !== '')

export const runFilterSearch = (filters: RunFilters, page: number): string => {
  const search = new URLSearchParams()
  if (page > 1) search.set('page', String(page))
  if (filters.runId.trim() !== '') search.set('runId', filters.runId.trim())
  for (const status of filters.statuses) search.append('status', status)
  if (filters.startedFrom !== '') search.set('startedFrom', filters.startedFrom)
  if (filters.startedTo !== '') search.set('startedTo', filters.startedTo)
  if (filters.durationMinSeconds !== '')
    search.set('durationMinSeconds', filters.durationMinSeconds)
  if (filters.durationMaxSeconds !== '')
    search.set('durationMaxSeconds', filters.durationMaxSeconds)
  const query = search.toString()
  return query === '' ? '/runs' : `/runs?${query}`
}
