'use client'

import {
  WorkflowGraphSchema,
  validateWorkflow,
  workflowFileToWorkflow,
  type WorkflowFile,
  type WorkflowGraph,
} from '@slopify/workflow-model'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

export interface WorkflowGraphDiagnostic {
  readonly code: 'GRAPH_JSON_INVALID' | 'GRAPH_SCHEMA_INVALID' | 'GRAPH_SEMANTIC_INVALID'
  readonly message: string
  readonly path: readonly (string | number)[]
}

export type WorkflowGraphSourceResult =
  | Readonly<{
      status: 'VALID'
      value: WorkflowGraph
      diagnostics: readonly []
    }>
  | Readonly<{
      status: 'INVALID'
      diagnostics: readonly WorkflowGraphDiagnostic[]
    }>

const diagnostic = (
  code: WorkflowGraphDiagnostic['code'],
  message: string,
  path: readonly (string | number)[] = [],
): WorkflowGraphDiagnostic => ({ code, message, path })

export const formatWorkflowGraphSource = (graph: WorkflowGraph): string =>
  JSON.stringify(graph, null, 2)

export const parseWorkflowGraphSource = (
  source: string,
  workflow: WorkflowFile,
): WorkflowGraphSourceResult => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    return {
      status: 'INVALID',
      diagnostics: [diagnostic('GRAPH_JSON_INVALID', 'Graph definition is not valid JSON')],
    }
  }

  const parsed = WorkflowGraphSchema.safeParse(value)
  if (!parsed.success) {
    return {
      status: 'INVALID',
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic(
          'GRAPH_SCHEMA_INVALID',
          issue.message,
          issue.path.map((segment) =>
            typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
          ),
        ),
      ),
    }
  }

  const validation = validateWorkflow(
    workflowFileToWorkflow({
      ...workflow,
      graph: parsed.data,
    }),
  )
  if (!validation.valid) {
    return {
      status: 'INVALID',
      diagnostics: validation.findings.map((finding) =>
        diagnostic('GRAPH_SEMANTIC_INVALID', finding.message, finding.path),
      ),
    }
  }

  return { status: 'VALID', value: parsed.data, diagnostics: [] }
}

const displayPath = (path: readonly (string | number)[]): string =>
  path.length === 0
    ? 'Graph'
    : path.reduce<string>(
        (result, segment) =>
          typeof segment === 'number' ? `${result}[${segment}]` : `${result}.${segment}`,
        'Graph',
      )

export function WorkflowGraphJsonEditor({
  onChange,
  source,
  workflow,
}: Readonly<{
  onChange: (source: string) => void
  source: string
  workflow: WorkflowFile
}>) {
  const result = parseWorkflowGraphSource(source, workflow)
  const diagnosticsId = 'workflow-graph-diagnostics'

  return (
    <section className="grid gap-3">
      <Field>
        <div className="flex items-end justify-between gap-3">
          <div>
            <FieldLabel htmlFor="workflow-graph-source">Workflow graph JSON</FieldLabel>
            <FieldDescription>
              Must match the workflow graph schema and graph rules.
            </FieldDescription>
          </div>
          <Button
            disabled={result.status === 'INVALID'}
            onClick={() => {
              if (result.status === 'VALID') onChange(formatWorkflowGraphSource(result.value))
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Format JSON
          </Button>
        </div>
        <Textarea
          aria-describedby={diagnosticsId}
          aria-invalid={result.status === 'INVALID'}
          autoCapitalize="off"
          autoCorrect="off"
          className="min-h-80 resize-y font-mono text-xs/5 tab-size-2"
          id="workflow-graph-source"
          onChange={(event) => onChange(event.currentTarget.value)}
          spellCheck={false}
          value={source}
        />
      </Field>

      {result.status === 'INVALID' ? (
        <div
          className="rounded-md bg-destructive/10 px-3 py-2 text-xs/4 text-destructive"
          id={diagnosticsId}
          role="alert"
        >
          <p className="font-medium">Graph definition has errors</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.diagnostics.map((finding, index) => (
              <li key={`${finding.code}-${finding.path.join('.')}-${index}`}>
                <span className="font-mono">{displayPath(finding.path)}</span>: {finding.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs/4 text-muted-foreground" id={diagnosticsId} role="status">
          Graph definition is valid.
        </p>
      )}
    </section>
  )
}
