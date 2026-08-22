import { WorkflowSchema } from '@slopify/workflow-model'

import type { RunService } from '../services/run-service.js'
import type { WorkflowCoordinator } from './workflow-coordinator.js'

export const createOrchestratedRunService = (
  options: Readonly<{
    runs: RunService
    coordinator: WorkflowCoordinator
  }>,
): RunService => ({
  stopAdmissions: () => options.runs.stopAdmissions(),
  async create(input) {
    const run = await options.runs.create(input)
    options.coordinator.start({
      runId: run.runId,
      workflow: WorkflowSchema.parse(run.workflowSnapshot),
    })
    return options.runs.get(run.runId)?.run ?? run
  },
  get: (runId) => options.runs.get(runId),
  list: (input) => options.runs.list(input),
})
