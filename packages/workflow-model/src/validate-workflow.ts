import type { NodeId } from '@loop/contracts'

import { getReachableNodeIds } from './graph-queries.js'
import { WorkflowRevisionSchema } from './schemas.js'
import type { WorkflowRevision } from './types.js'

export const WORKFLOW_VALIDATION_CODES = [
  'SCHEMA_INVALID',
  'DUPLICATE_NODE_ID',
  'START_NODE_NOT_FOUND',
  'START_NODE_AMBIGUOUS',
  'TERMINAL_NODE_MISSING',
  'EDGE_SOURCE_NOT_FOUND',
  'EDGE_TARGET_NOT_FOUND',
  'START_NODE_HAS_INCOMING_EDGE',
  'TERMINAL_NODE_HAS_OUTGOING_EDGE',
  'EDGE_OUTCOME_UNDECLARED',
  'OUTCOME_EDGE_MISSING',
  'OUTCOME_EDGE_AMBIGUOUS',
  'NODE_UNREACHABLE',
  'COMMAND_UNREGISTERED',
] as const

export type WorkflowValidationCode = (typeof WORKFLOW_VALIDATION_CODES)[number]
export type WorkflowValidationPath = readonly (string | number)[]

export interface WorkflowValidationFinding {
  readonly code: WorkflowValidationCode
  readonly path: WorkflowValidationPath
  readonly message: string
}

export interface WorkflowValidationOptions {
  readonly registeredCommandIds: ReadonlySet<string>
}

export type WorkflowValidationResult =
  | Readonly<{
      valid: true
      workflow: WorkflowRevision
      findings: readonly []
    }>
  | Readonly<{
      valid: false
      findings: readonly WorkflowValidationFinding[]
    }>

const NO_FINDINGS: readonly [] = Object.freeze([])

function createFinding(
  code: WorkflowValidationCode,
  path: WorkflowValidationPath,
  message: string,
): WorkflowValidationFinding {
  return Object.freeze({ code, path: Object.freeze([...path]), message })
}

function comparePathSegments(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  const leftValue = String(left)
  const rightValue = String(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

function compareFindings(
  left: WorkflowValidationFinding,
  right: WorkflowValidationFinding,
): number {
  const length = Math.max(left.path.length, right.path.length)
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left.path[index]
    const rightSegment = right.path[index]
    if (leftSegment === undefined) return -1
    if (rightSegment === undefined) return 1
    const comparison = comparePathSegments(leftSegment, rightSegment)
    if (comparison !== 0) return comparison
  }
  if (left.code < right.code) return -1
  if (left.code > right.code) return 1
  return 0
}

function invalidResult(findings: WorkflowValidationFinding[]): WorkflowValidationResult {
  return Object.freeze({
    valid: false,
    findings: Object.freeze(findings.toSorted(compareFindings)),
  })
}

function validateNodeIdentities(
  workflow: WorkflowRevision,
  findings: WorkflowValidationFinding[],
): Map<NodeId, number[]> {
  const indexesByNodeId = new Map<NodeId, number[]>()

  workflow.nodes.forEach((node, nodeIndex) => {
    const indexes = indexesByNodeId.get(node.id) ?? []
    if (indexes.length > 0) {
      findings.push(
        createFinding(
          'DUPLICATE_NODE_ID',
          ['nodes', nodeIndex, 'id'],
          `Node ID "${node.id}" is declared more than once.`,
        ),
      )
    }
    indexes.push(nodeIndex)
    indexesByNodeId.set(node.id, indexes)
  })

  const startIndexes = indexesByNodeId.get(workflow.startNodeId) ?? []
  if (startIndexes.length === 0) {
    findings.push(
      createFinding(
        'START_NODE_NOT_FOUND',
        ['startNodeId'],
        `Start node "${workflow.startNodeId}" does not exist.`,
      ),
    )
  } else if (startIndexes.length > 1) {
    findings.push(
      createFinding(
        'START_NODE_AMBIGUOUS',
        ['startNodeId'],
        `Start node "${workflow.startNodeId}" resolves to multiple nodes.`,
      ),
    )
  }

  if (!workflow.nodes.some((node) => node.type === 'terminal')) {
    findings.push(
      createFinding('TERMINAL_NODE_MISSING', ['nodes'], 'Workflow must declare a terminal node.'),
    )
  }

  return indexesByNodeId
}

function validateEdges(
  workflow: WorkflowRevision,
  indexesByNodeId: ReadonlyMap<NodeId, readonly number[]>,
  findings: WorkflowValidationFinding[],
): void {
  workflow.edges.forEach((edge, edgeIndex) => {
    const sourceIndexes = indexesByNodeId.get(edge.sourceNodeId) ?? []
    const targetIndexes = indexesByNodeId.get(edge.targetNodeId) ?? []

    if (sourceIndexes.length === 0) {
      findings.push(
        createFinding(
          'EDGE_SOURCE_NOT_FOUND',
          ['edges', edgeIndex, 'sourceNodeId'],
          `Edge source "${edge.sourceNodeId}" does not exist.`,
        ),
      )
    }
    if (targetIndexes.length === 0) {
      findings.push(
        createFinding(
          'EDGE_TARGET_NOT_FOUND',
          ['edges', edgeIndex, 'targetNodeId'],
          `Edge target "${edge.targetNodeId}" does not exist.`,
        ),
      )
    }
    if (edge.targetNodeId === workflow.startNodeId) {
      findings.push(
        createFinding(
          'START_NODE_HAS_INCOMING_EDGE',
          ['edges', edgeIndex, 'targetNodeId'],
          'The start node cannot have an incoming edge.',
        ),
      )
    }

    if (sourceIndexes.length !== 1) {
      return
    }

    const sourceNode = workflow.nodes[sourceIndexes[0] as number]
    if (sourceNode === undefined) {
      return
    }
    if (sourceNode.type === 'terminal') {
      findings.push(
        createFinding(
          'TERMINAL_NODE_HAS_OUTGOING_EDGE',
          ['edges', edgeIndex, 'sourceNodeId'],
          `Terminal node "${sourceNode.id}" cannot have an outgoing edge.`,
        ),
      )
      return
    }
    if (!sourceNode.outcomes.includes(edge.outcome)) {
      findings.push(
        createFinding(
          'EDGE_OUTCOME_UNDECLARED',
          ['edges', edgeIndex, 'outcome'],
          `Outcome "${edge.outcome}" is not declared by node "${sourceNode.id}".`,
        ),
      )
    }
  })
}

function validateOutcomes(workflow: WorkflowRevision, findings: WorkflowValidationFinding[]): void {
  workflow.nodes.forEach((node, nodeIndex) => {
    if (node.type === 'terminal') {
      return
    }

    node.outcomes.forEach((outcome, outcomeIndex) => {
      const edgeCount = workflow.edges.filter(
        (edge) => edge.sourceNodeId === node.id && edge.outcome === outcome,
      ).length
      if (edgeCount === 0) {
        findings.push(
          createFinding(
            'OUTCOME_EDGE_MISSING',
            ['nodes', nodeIndex, 'outcomes', outcomeIndex],
            `Outcome "${outcome}" on node "${node.id}" has no edge.`,
          ),
        )
      } else if (edgeCount > 1) {
        findings.push(
          createFinding(
            'OUTCOME_EDGE_AMBIGUOUS',
            ['nodes', nodeIndex, 'outcomes', outcomeIndex],
            `Outcome "${outcome}" on node "${node.id}" has multiple edges.`,
          ),
        )
      }
    })
  })
}

function validateReachability(
  workflow: WorkflowRevision,
  indexesByNodeId: ReadonlyMap<NodeId, readonly number[]>,
  findings: WorkflowValidationFinding[],
): void {
  if ((indexesByNodeId.get(workflow.startNodeId) ?? []).length !== 1) {
    return
  }

  const reachableNodeIds = new Set(getReachableNodeIds(workflow))
  workflow.nodes.forEach((node, nodeIndex) => {
    if (!reachableNodeIds.has(node.id)) {
      findings.push(
        createFinding(
          'NODE_UNREACHABLE',
          ['nodes', nodeIndex, 'id'],
          `Node "${node.id}" is unreachable from the start node.`,
        ),
      )
    }
  })
}

function validateCommands(
  workflow: WorkflowRevision,
  registeredCommandIds: ReadonlySet<string>,
  findings: WorkflowValidationFinding[],
): void {
  workflow.nodes.forEach((node, nodeIndex) => {
    if (node.type === 'command' && !registeredCommandIds.has(node.commandId)) {
      findings.push(
        createFinding(
          'COMMAND_UNREGISTERED',
          ['nodes', nodeIndex, 'commandId'],
          `Command "${node.commandId}" is not registered.`,
        ),
      )
    }
  })
}

export function validateWorkflow(
  input: unknown,
  options: WorkflowValidationOptions,
): WorkflowValidationResult {
  const parsed = WorkflowRevisionSchema.safeParse(input)
  if (!parsed.success) {
    return invalidResult(
      parsed.error.issues.map((issue) =>
        createFinding(
          'SCHEMA_INVALID',
          issue.path.map((segment) =>
            typeof segment === 'string' || typeof segment === 'number' ? segment : String(segment),
          ),
          issue.message,
        ),
      ),
    )
  }

  const findings: WorkflowValidationFinding[] = []
  const indexesByNodeId = validateNodeIdentities(parsed.data, findings)
  validateEdges(parsed.data, indexesByNodeId, findings)
  validateOutcomes(parsed.data, findings)
  validateReachability(parsed.data, indexesByNodeId, findings)
  validateCommands(parsed.data, options.registeredCommandIds, findings)

  if (findings.length > 0) {
    return invalidResult(findings)
  }

  return Object.freeze({ valid: true, workflow: parsed.data, findings: NO_FINDINGS })
}
