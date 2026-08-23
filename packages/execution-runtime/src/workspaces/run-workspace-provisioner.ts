import type { ProjectId, RunId } from '@slopify/contracts'

import type { RunProjectSnapshot } from '../persistence/run-repository.js'

export interface ProvisionedRunProject extends RunProjectSnapshot {
  readonly worktreePath: string
}

export interface RunWorkspaceProvisioner {
  ensure(runId: RunId): Promise<readonly ProvisionedRunProject[]>
}

export interface RunWorkspaceProvisioningFailure {
  readonly projectId: ProjectId
  readonly message: string
}

export class RunWorkspaceProvisioningError extends Error {
  override readonly name = 'RunWorkspaceProvisioningError'
  readonly code = 'RUN_WORKSPACE_PROVISIONING_FAILED' as const

  constructor(readonly failures: readonly RunWorkspaceProvisioningFailure[]) {
    super(
      failures.length === 1
        ? failures[0]?.message
        : `${failures.length} run project worktrees could not be prepared`,
    )
  }
}
