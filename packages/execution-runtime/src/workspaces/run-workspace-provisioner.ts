import type { RepositoryId, RunId } from '@slopify/contracts'

import type { RunRepositorySnapshot } from '../persistence/run-repository.js'

export interface ProvisionedRunRepository extends RunRepositorySnapshot {
  readonly workspacePath: string
  readonly branchName: string
}

export interface RunWorkspaceProvisioner {
  ensure(runId: RunId): Promise<readonly ProvisionedRunRepository[]>
  cleanup(runId: RunId): Promise<void>
}

export interface RunWorkspaceProvisioningFailure {
  readonly repositoryId: RepositoryId
  readonly message: string
}

export class RunWorkspaceProvisioningError extends Error {
  override readonly name = 'RunWorkspaceProvisioningError'
  readonly code = 'RUN_WORKSPACE_PROVISIONING_FAILED' as const

  constructor(readonly failures: readonly RunWorkspaceProvisioningFailure[]) {
    super(
      failures.length === 1
        ? failures[0]?.message
        : `${failures.length} run repository workspaces could not be prepared`,
    )
  }
}
