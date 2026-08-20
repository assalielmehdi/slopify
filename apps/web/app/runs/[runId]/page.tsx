import { LiveRun } from '@/components/runs/live-run'

export default async function RunPage({
  params,
}: Readonly<{ params: Promise<{ runId: string }> }>) {
  const { runId } = await params
  return <LiveRun runId={runId} />
}
