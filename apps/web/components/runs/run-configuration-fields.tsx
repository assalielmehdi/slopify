import { PlusIcon, XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { WorkflowCatalogEntry } from '@/lib/api-client'

export interface RunVariableRow {
  readonly id: string
  readonly key: string
  readonly required: boolean
  readonly value: string
}

export interface RunConfigurationFieldsProps {
  readonly onAddVariable: () => void
  readonly onRemoveVariable: (id: string) => void
  readonly onVariableKeyChange: (id: string, key: string) => void
  readonly onVariableValueChange: (id: string, value: string) => void
  readonly onWorkflowChange: (workflowId: string) => void
  readonly rows: readonly RunVariableRow[]
  readonly workflowId: string
  readonly workflows: readonly WorkflowCatalogEntry[]
}

export function RunConfigurationFields({
  onAddVariable,
  onRemoveVariable,
  onVariableKeyChange,
  onVariableValueChange,
  onWorkflowChange,
  rows,
  workflowId,
  workflows,
}: RunConfigurationFieldsProps) {
  return (
    <FieldGroup className="grid gap-6">
      <Field>
        <FieldLabel htmlFor="workflow">Workflow</FieldLabel>
        <NativeSelect
          id="workflow"
          onChange={(event) => onWorkflowChange(event.currentTarget.value)}
          value={workflowId}
        >
          {workflows.map((workflow) => (
            <NativeSelectOption key={workflow.workflowId} value={workflow.workflowId}>
              {workflow.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm/5 font-semibold">Variables</h2>
            <p className="mt-1 text-xs/4 text-muted-foreground">
              Prompt variables are prelisted. Values accept JSON; invalid JSON remains text.
            </p>
          </div>
          <Button onClick={onAddVariable} size="sm" type="button" variant="outline">
            <PlusIcon aria-hidden="true" /> Add variable
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm/5 text-muted-foreground">
            This workflow has no prompt variables. Add one only if the workflow expects runtime
            context outside its prompt templates.
          </p>
        ) : (
          <div className="grid gap-2">
            {rows.map((row, index) => {
              const variableLabel = row.key.trim() === '' ? String(index + 1) : row.key
              return (
                <div
                  className="grid items-end gap-2 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1.2fr)_auto]"
                  key={row.id}
                >
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-key`}>Name</FieldLabel>
                    <Input
                      aria-label={`Variable name ${index + 1}`}
                      disabled={row.required}
                      id={`${row.id}-key`}
                      onChange={(event) => onVariableKeyChange(row.id, event.currentTarget.value)}
                      value={row.key}
                    />
                    {row.required ? (
                      <FieldDescription>Required by a prompt</FieldDescription>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${row.id}-value`}>Value</FieldLabel>
                    <Input
                      aria-label={`Variable value for ${variableLabel}`}
                      id={`${row.id}-value`}
                      onChange={(event) => onVariableValueChange(row.id, event.currentTarget.value)}
                      placeholder='Text, 42, true, null, ["one"], or {"key":"value"}'
                      value={row.value}
                    />
                  </Field>
                  <Button
                    aria-label={`Remove variable ${variableLabel}`}
                    className="self-end"
                    disabled={row.required}
                    onClick={() => onRemoveVariable(row.id)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </FieldGroup>
  )
}
