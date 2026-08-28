import type { ReactNode } from 'react'

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
import type { WorkflowCatalogEntry } from '@/lib/api-client'

export interface RunVariableRow {
  readonly id: string
  readonly key: string
  readonly value: string
}

export interface RunConfigurationFieldsProps {
  readonly onVariableValueChange: (id: string, value: string) => void
  readonly onWorkflowChange: (workflowId: string) => void
  readonly rows: readonly RunVariableRow[]
  readonly workflowId: string
  readonly workflows: readonly WorkflowCatalogEntry[]
  readonly showWorkflowSelector?: boolean | undefined
  readonly trailingAction?: ReactNode
}

export function RunConfigurationFields({
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
                {workflow.workflowId}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <div className="grid gap-3">
        <div>
          <h2 className="text-sm/5 font-semibold">Variables</h2>
          <p className="mt-1 text-xs/4 text-muted-foreground">
            Enter one value for every variable declared by this workflow. Values accept JSON;
            invalid JSON remains text.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm/5 text-muted-foreground">
            This workflow has no configured variables.
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
                return (
                  <TableRow className="h-auto hover:bg-transparent" key={row.id}>
                    <TableCell className="px-0 py-3 pr-3 align-top whitespace-normal">
                      <code className="block min-h-9 content-center break-words font-mono text-sm/5">
                        {row.key}
                      </code>
                    </TableCell>
                    <TableCell className="px-0 py-3 pl-3 align-top whitespace-normal">
                      <div>
                        <Field>
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
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        <div data-testid="run-variable-actions" className="flex items-center justify-end">
          {trailingAction}
        </div>
      </div>
    </FieldGroup>
  )
}
