import type { Metadata } from 'next'

import { LiveRun } from '@/components/runs/live-run'
import { displayRunId } from '@/lib/run-id'

type RunPageProps = Readonly<{ params: Promise<{ runId: string }> }>

export async function generateMetadata({ params }: RunPageProps): Promise<Metadata> {
  const { runId } = await params
  return { title: `Run ${displayRunId(runId)}` }
}

export default async function RunPage({ params }: RunPageProps) {
  const { runId } = await params
  return <LiveRun runId={runId} />
}
