import {
  WorkflowFileSchema,
  validateWorkflow,
  workflowFileToWorkflow,
  type WorkflowFile,
} from '@slopify/workflow-model'

import type { ResourceRevision } from '../filesystem/resource-revision.js'

const NO_DIAGNOSTICS: readonly [] = Object.freeze([])

export type WorkflowDiagnosticCode =
  | 'WORKFLOW_DIRECTORY_INVALID'
  | 'WORKFLOW_FILE_MISSING'
  | 'WORKFLOW_FILE_MALFORMED'
  | 'WORKFLOW_FILE_INVALID'
  | 'WORKFLOW_ID_MISMATCH'
  | 'WORKFLOW_GRAPH_INVALID'
  | 'WORKFLOW_ENTRY_UNAVAILABLE'

export interface WorkflowDiagnostic {
  readonly code: WorkflowDiagnosticCode
  readonly message: string
  readonly path: readonly (string | number)[]
}

export type WorkflowSource =
  | Readonly<{
      status: 'VALID'
      workflowId: string
      source: string
      revision: ResourceRevision
      value: WorkflowFile
      diagnostics: readonly []
    }>
  | Readonly<{
      status: 'INVALID'
      workflowId: string
      source: string | null
      revision: ResourceRevision | null
      diagnostics: readonly WorkflowDiagnostic[]
    }>

export const workflowDiagnostic = (
  code: WorkflowDiagnosticCode,
  message: string,
  path: readonly (string | number)[] = [],
): WorkflowDiagnostic => Object.freeze({ code, message, path: Object.freeze([...path]) })

export const invalidWorkflowSource = (input: {
  readonly workflowId: string
  readonly source: string | null
  readonly revision: ResourceRevision | null
  readonly diagnostics: readonly WorkflowDiagnostic[]
}): WorkflowSource =>
  Object.freeze({
    status: 'INVALID',
    workflowId: input.workflowId,
    source: input.source,
    revision: input.revision,
    diagnostics: Object.freeze([...input.diagnostics]),
  })

const graphDiagnosticPath = (path: readonly (string | number)[]) => ['graph', ...path]

export const parseWorkflowSource = (input: {
  readonly workflowId: string
  readonly source: string
  readonly revision: ResourceRevision
}): WorkflowSource => {
  let value: unknown
  try {
    value = JSON.parse(input.source)
  } catch {
    return invalidWorkflowSource({
      ...input,
      diagnostics: [
        workflowDiagnostic('WORKFLOW_FILE_MALFORMED', 'Workflow definition is not valid JSON'),
      ],
    })
  }
  const parsed = WorkflowFileSchema.safeParse(value)
  if (!parsed.success) {
    return invalidWorkflowSource({
      ...input,
      diagnostics: parsed.error.issues.map((issue) =>
        workflowDiagnostic(
          'WORKFLOW_FILE_INVALID',
          issue.message,
          issue.path.map((segment) =>
            typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
          ),
        ),
      ),
    })
  }
  if (parsed.data.workflowId !== input.workflowId) {
    return invalidWorkflowSource({
      ...input,
      diagnostics: [
        workflowDiagnostic(
          'WORKFLOW_ID_MISMATCH',
          'Workflow ID must match its containing directory',
          ['workflowId'],
        ),
      ],
    })
  }
  const validation = validateWorkflow(workflowFileToWorkflow(parsed.data))
  if (!validation.valid) {
    return invalidWorkflowSource({
      ...input,
      diagnostics: validation.findings.map((finding) =>
        workflowDiagnostic(
          'WORKFLOW_GRAPH_INVALID',
          finding.message,
          graphDiagnosticPath(finding.path),
        ),
      ),
    })
  }
  return Object.freeze({
    status: 'VALID',
    workflowId: input.workflowId,
    source: input.source,
    revision: input.revision,
    value: parsed.data,
    diagnostics: NO_DIAGNOSTICS,
  })
}
