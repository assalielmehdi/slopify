import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LiveRun } from '@/components/runs/live-run'
import { displayRunId } from '@/lib/run-id'

type RunPageProps = Readonly<{ params: Promise<{ runId: string }> }>

const generatedRunId = (runId: string): string => {
  if (!runId.startsWith('run-') || runId.length === 'run-'.length) notFound()
  return runId
}

export async function generateMetadata({ params }: RunPageProps): Promise<Metadata> {
  const runId = generatedRunId((await params).runId)
  return { title: `Run ${displayRunId(runId)}` }
}

export default async function RunPage({ params }: RunPageProps) {
  const runId = generatedRunId((await params).runId)
  return <LiveRun runId={runId} />
}
