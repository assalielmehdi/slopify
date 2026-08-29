'use client'

import { useEffect, useState } from 'react'

import { formatDuration } from '@/lib/run-format'

interface ElapsedTimeProps {
  readonly completedAt: string | null
  readonly running: boolean
  readonly startedAt: string | null
}

export function ElapsedTime({ completedAt, running, startedAt }: ElapsedTimeProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running])

  if (startedAt === null) return <>Not started</>
  const end = completedAt === null ? now : Date.parse(completedAt)
  return <>{formatDuration(Math.max(0, end - Date.parse(startedAt)))}</>
}
