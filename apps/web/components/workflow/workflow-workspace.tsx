import type { CSSProperties, ReactNode } from 'react'

import type { Workflow } from '@slopify/workflow-model'

import { workflowGraphPaneWidth } from '@/lib/workflow-graph-layout'

interface WorkflowWorkspaceProps {
  readonly details: ReactNode
  readonly graph: ReactNode
  readonly workflow: Workflow
}

export function WorkflowWorkspace({ details, graph, workflow }: WorkflowWorkspaceProps) {
  return (
    <div
      className="workflow-workspace grid h-full min-h-0 min-w-0 overflow-hidden"
      data-layout="adaptive-split"
      data-testid="workflow-workspace"
      style={
        {
          '--workflow-graph-pane-width': `${workflowGraphPaneWidth(workflow)}px`,
        } as CSSProperties
      }
    >
      <section
        aria-label="Workflow graph pane"
        className="min-h-0 min-w-0 overflow-hidden border-b border-border lg:border-r lg:border-b-0"
      >
        {graph}
      </section>
      <section
        aria-label="Workflow details pane"
        className="min-h-0 min-w-0 overflow-hidden bg-background"
      >
        {details}
      </section>
    </div>
  )
}
