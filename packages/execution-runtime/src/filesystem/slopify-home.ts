import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { RunIdSchema } from '@slopify/contracts'
import { WorkflowSlugSchema } from '@slopify/workflow-model'
import type { z } from 'zod'

export interface SlopifyWorkflowPaths {
  readonly directory: string
  readonly definitionFile: string
  readonly runsDirectory: string
}

export interface SlopifyRunPaths {
  readonly directory: string
  readonly runFile: string
  readonly workflowSnapshotFile: string
  readonly variablesFile: string
  readonly repositoriesSnapshotFile: string
  readonly workspacesFile: string
  readonly eventsFile: string
  readonly nodesDirectory: string
  readonly workspacesDirectory: string
}

export interface SlopifyPaths {
  readonly home: string
  readonly settingsFile: string
  readonly repositoriesFile: string
  readonly schemasDirectory: string
  readonly workflowsDirectory: string
  readonly runtimeDirectory: string
  readonly migrationsDirectory: string
  workflow(workflowId: string): SlopifyWorkflowPaths
  run(workflowId: string, runId: string): SlopifyRunPaths
}

type Environment = Readonly<Record<string, string | undefined>>

const identifier = (kind: string, schema: z.ZodType<string>, value: string): string => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new TypeError(`${kind} is invalid`)
  return parsed.data
}

export const resolveSlopifyPaths = (
  options: Readonly<{
    environment?: Environment
    homeDirectory?: string
  }> = {},
): SlopifyPaths => {
  const environment = options.environment ?? process.env
  const configuredHome = environment.SLOPIFY_HOME
  if (configuredHome !== undefined && configuredHome.trim() === '')
    throw new TypeError('SLOPIFY_HOME must not be blank')
  const home = resolve(configuredHome ?? join(options.homeDirectory ?? homedir(), '.slopify'))
  const workflowsDirectory = join(home, 'workflows')

  const workflow = (workflowId: string): SlopifyWorkflowPaths => {
    const safeWorkflowId = identifier('Workflow ID', WorkflowSlugSchema, workflowId)
    const directory = join(workflowsDirectory, safeWorkflowId)
    return {
      directory,
      definitionFile: join(directory, 'workflow.json'),
      runsDirectory: join(directory, 'runs'),
    }
  }

  return {
    home,
    settingsFile: join(home, 'settings.json'),
    repositoriesFile: join(home, 'repositories.json'),
    schemasDirectory: join(home, 'schemas'),
    workflowsDirectory,
    runtimeDirectory: join(home, 'runtime'),
    migrationsDirectory: join(home, 'migrations'),
    workflow,
    run(workflowId, runId) {
      const workflowPaths = workflow(workflowId)
      const safeRunId = identifier('Run ID', RunIdSchema, runId)
      const directory = join(workflowPaths.runsDirectory, safeRunId)
      return {
        directory,
        runFile: join(directory, 'run.json'),
        workflowSnapshotFile: join(directory, 'workflow.snapshot.json'),
        variablesFile: join(directory, 'variables.json'),
        repositoriesSnapshotFile: join(directory, 'repositories.snapshot.json'),
        workspacesFile: join(directory, 'workspaces.json'),
        eventsFile: join(directory, 'events.jsonl'),
        nodesDirectory: join(directory, 'nodes'),
        workspacesDirectory: join(directory, 'workspaces'),
      }
    },
  }
}
