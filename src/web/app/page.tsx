import type { Metadata } from 'next'

import { WorkflowWorkbench } from '@/components/workflow/workflow-workbench'

export const metadata: Metadata = {
  title: 'Editor',
}

interface PageProps {
  readonly searchParams: Promise<{ readonly workflowId?: string | readonly string[] | undefined }>
}

export default async function Page({ searchParams }: PageProps) {
  const workflowId = (await searchParams).workflowId
  return (
    <WorkflowWorkbench
      selectedWorkflowId={typeof workflowId === 'string' ? workflowId : undefined}
    />
  )
}
