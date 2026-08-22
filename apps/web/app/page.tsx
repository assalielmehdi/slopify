import type { Metadata } from 'next'

import { WorkflowWorkbench } from '@/components/workflow/workflow-workbench'

export const metadata: Metadata = {
  title: 'Editor',
}

export default function Page() {
  return <WorkflowWorkbench />
}
