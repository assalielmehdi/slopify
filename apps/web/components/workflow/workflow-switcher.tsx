'use client'

import type { Project } from '@slopify/contracts'
import type { Workflow } from '@slopify/workflow-model'
import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

export interface WorkflowSwitcherProps {
  readonly disabled: boolean
  readonly onCreate: () => void
  readonly onSelect: (workflowId: string) => void
  readonly projects: readonly Project[]
  readonly selectedWorkflowId?: string | undefined
  readonly workflows: readonly Workflow[]
}

const workflowLabel = (workflow: Workflow, projects: readonly Project[]) => {
  const primaryProject = projects.find(
    ({ projectId }) => projectId === workflow.configuration.primaryProjectId,
  )
  return `${workflow.name} — ${primaryProject?.name ?? 'No primary project'}`
}

export function WorkflowSwitcher({
  disabled,
  onCreate,
  onSelect,
  projects,
  selectedWorkflowId,
  workflows,
}: WorkflowSwitcherProps) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      {selectedWorkflowId === undefined ? (
        <p className="text-sm text-muted-foreground">No workflows yet</p>
      ) : (
        <Field className="min-w-0">
          <FieldLabel className="sr-only" htmlFor="workflow-selector">
            Workflow
          </FieldLabel>
          <NativeSelect
            aria-label="Workflow"
            className="w-[min(24rem,calc(100vw-13rem))]"
            disabled={disabled}
            id="workflow-selector"
            onChange={(event) => onSelect(event.currentTarget.value)}
            value={selectedWorkflowId}
          >
            {workflows.map((workflow) => (
              <NativeSelectOption key={workflow.workflowId} value={workflow.workflowId}>
                {workflowLabel(workflow, projects)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Button disabled={disabled} onClick={onCreate} size="sm" type="button" variant="outline">
        <PlusIcon aria-hidden="true" /> New workflow
      </Button>
    </div>
  )
}
