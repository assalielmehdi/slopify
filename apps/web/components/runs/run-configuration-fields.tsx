import { PlusIcon, Trash2Icon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  readonly showWorkflowSelector?: boolean | undefined
  readonly trailingAction?: ReactNode
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
  showWorkflowSelector = true,
  trailingAction,
}: RunConfigurationFieldsProps) {
  return (
    <FieldGroup className="grid gap-6">
      {showWorkflowSelector ? (
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
      ) : null}

      <div className="grid gap-3">
        <div>
          <h2 className="text-sm/5 font-semibold">Variables</h2>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Prompt variables are prelisted. Values accept JSON; invalid JSON remains text.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm/5 text-muted-foreground">
            This workflow has no prompt variables. Add one only if the workflow expects runtime
            context outside its prompt templates.
          </p>
        ) : (
          <Table aria-label="Run variables" className="table-fixed">
            <colgroup>
              <col className="w-2/5" />
              <col className="w-3/5" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-0 pr-3">Name</TableHead>
                <TableHead className="px-0 pl-3">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-b-0">
              {rows.map((row, index) => {
                const variableLabel = row.key.trim() === '' ? String(index + 1) : row.key
                const nameInput = (
                  <Input
                    aria-label={`Variable name ${index + 1}`}
                    disabled={row.required}
                    id={`${row.id}-key`}
                    onChange={(event) => onVariableKeyChange(row.id, event.currentTarget.value)}
                    value={row.key}
                  />
                )
                return (
                  <TableRow className="h-auto hover:bg-transparent" key={row.id}>
                    <TableCell className="px-0 py-3 pr-3 align-top whitespace-normal">
                      <Field>
                        <FieldLabel className="sr-only" htmlFor={`${row.id}-key`}>
                          Name
                        </FieldLabel>
                        {row.required ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <div
                                  aria-label={`${row.key} is required by a prompt`}
                                  className="w-full"
                                  tabIndex={0}
                                />
                              }
                            >
                              {nameInput}
                            </TooltipTrigger>
                            <TooltipContent>Required by a prompt</TooltipContent>
                          </Tooltip>
                        ) : (
                          nameInput
                        )}
                      </Field>
                    </TableCell>
                    <TableCell className="px-0 py-3 pl-3 align-top whitespace-normal">
                      <div className="flex items-start gap-2">
                        <Field className="min-w-0 flex-1">
                          <FieldLabel className="sr-only" htmlFor={`${row.id}-value`}>
                            Value
                          </FieldLabel>
                          <Input
                            aria-label={`Variable value for ${variableLabel}`}
                            id={`${row.id}-value`}
                            onChange={(event) =>
                              onVariableValueChange(row.id, event.currentTarget.value)
                            }
                            placeholder='Text, 42, true, null, ["one"], or {"key":"value"}'
                            value={row.value}
                          />
                        </Field>
                        <Button
                          aria-label={`Remove variable ${variableLabel}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive dark:hover:bg-destructive/20"
                          disabled={row.required}
                          onClick={() => onRemoveVariable(row.id)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <div data-testid="run-variable-actions" className="flex items-center justify-end gap-2">
          <Button
            className="border-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onAddVariable}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon aria-hidden="true" /> Add variable
          </Button>
          {trailingAction}
        </div>
      </div>
    </FieldGroup>
  )
}
