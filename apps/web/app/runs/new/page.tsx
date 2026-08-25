import type { Metadata } from 'next'

import { StartRunForm } from '@/components/runs/start-run-form'

export const metadata: Metadata = {
  title: 'Start a run',
}

interface NewRunPageProps {
  readonly searchParams: Promise<{ readonly workflowId?: string | readonly string[] | undefined }>
}

export default async function NewRunPage({ searchParams }: NewRunPageProps) {
  const workflowId = (await searchParams).workflowId
  return (
    <StartRunForm initialWorkflowId={typeof workflowId === 'string' ? workflowId : undefined} />
  )
}
