const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })

const sameUtcDay = (left: Date, right: Date): boolean =>
  left.getUTCFullYear() === right.getUTCFullYear() &&
  left.getUTCMonth() === right.getUTCMonth() &&
  left.getUTCDate() === right.getUTCDate()

export const formatDuration = (durationMs: number): string => {
  if (durationMs < 1_000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`
  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [
    hours === 0 ? undefined : `${hours}h`,
    minutes === 0 ? undefined : `${minutes}m`,
    seconds === 0 ? undefined : `${seconds}s`,
  ]
    .filter((part) => part !== undefined)
    .join(' ')
}

export const formatTimestamp = (timestamp: string | null): string =>
  timestamp === null ? 'Not recorded' : timestampFormatter.format(new Date(timestamp))

export function formatRunHistoryTimestamp(timestamp: string | null, now = new Date()): string {
  if (timestamp === null) return 'Not recorded'
  const startedAt = new Date(timestamp)
  const elapsedMs = now.getTime() - startedAt.getTime()
  if (elapsedMs < 0 || !sameUtcDay(startedAt, now)) return formatTimestamp(timestamp)

  const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1_000))
  if (elapsedSeconds < 60) return relativeTimeFormatter.format(-elapsedSeconds, 'second')
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return relativeTimeFormatter.format(-elapsedMinutes, 'minute')
  return relativeTimeFormatter.format(-Math.floor(elapsedMinutes / 60), 'hour')
}
