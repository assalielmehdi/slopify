export {
  resolveSlopifyPaths,
  type SlopifyPaths,
  type SlopifyRunPaths,
  type SlopifyWorkflowPaths,
} from './platform/filesystem/slopify-home.js'
export {
  RUN_ARTIFACT_AUTHORITY,
  NodeExecutionProjectionSchema,
  RunProjectionSchema,
  RunRepositoriesSnapshotSchema,
  RunVariablesSnapshotSchema,
  RunWorkflowSnapshotSchema,
  RunWorkspaceStatusSchema,
  RunWorkspacesProjectionSchema,
  type NodeExecutionProjection,
  type RunProjection,
  type RunRepositoriesSnapshot,
  type RunRepositorySnapshotArtifact,
  type RunVariablesSnapshot,
  type RunWorkflowSnapshot,
  type RunWorkspaceProjection,
  type RunWorkspacesProjection,
  type RunWorkspaceStatus,
} from './modules/run/runs/run-artifacts.js'
export {
  resolveNodeExecutionPaths,
  type NodeExecutionPaths,
} from './modules/run/runs/run-layout.js'
export {
  FilesystemRunStoreError,
  createFilesystemRunStore,
  type FilesystemRunAdmissionInput,
  type FilesystemRunStore,
  type FilesystemRunStoreErrorCode,
} from './modules/run/runs/filesystem-run-store.js'
export {
  createFilesystemRunArtifactDirectory,
  type FilesystemRunArtifactDirectory,
  type RunArtifactLocator,
} from './modules/run/runs/filesystem-run-artifact-directory.js'
export { RunDomainEventSchema, type RunDomainEvent } from './modules/run/runs/run-events.js'
export { createFilesystemRunJournal } from './modules/run/runs/filesystem-run-journal.js'
export {
  createFilesystemRunIndex,
  createFilesystemRunReader,
  type FilesystemRunDetail,
  type FilesystemRunDiagnostic,
  type FilesystemRunIndex,
  type FilesystemRunIndexEntry,
  type FilesystemRunIndexPage,
  type FilesystemRunLocator,
  type ListRunsInput,
  type FilesystemRunReader,
} from './modules/run/runs/run-index.js'
export {
  RunJournalError,
  type NewRunDomainEvent,
  type RunJournal,
  type RunJournalDiagnostic,
  type RunJournalDiagnosticCode,
  type RunJournalErrorCode,
  type RunJournalReplay,
  type RunProjectionRepair,
} from './modules/run/runs/run-journal.js'
export {
  RunRecoveryError,
  createRunRecoveryService,
  type RunRecoveryErrorCode,
  type RunRecoveryService,
  type RunRecoveryStore,
  type RunRecoverySummary,
  type RunRecoveryWorkspaceCleaner,
} from './modules/run/runs/run-recovery-service.js'
export {
  RunProjectionError,
  createRunProjectionState,
  reduceRunEvents,
  type RunProjectionErrorCode,
  type RunProjectionState,
  type RunRoutingProjection,
} from './modules/run/runs/run-projection.js'
export {
  FilesystemResourceError,
  type FilesystemResourceErrorCode,
} from './platform/filesystem/filesystem-errors.js'
export {
  createAtomicJsonResourceIO,
  type AtomicJsonResourceIO,
  type ReadJsonResourceInput,
  type ReadResourceSourceInput,
  type VersionedJsonResource,
  type VersionedResourceSource,
  type WriteJsonResourceInput,
  type WriteVersionedJsonResourceInput,
} from './platform/filesystem/atomic-json-resource.js'
export {
  InstanceLockError,
  InstanceLockOwnerSchema,
  createInstanceLockManager,
  type InstanceLockErrorCode,
  type InstanceLockHandle,
  type InstanceLockManager,
  type InstanceLockOwner,
} from './platform/filesystem/instance-lock.js'
export {
  AppendOnlyJsonlError,
  createAppendOnlyJsonl,
  type AppendOnlyJsonl,
  type AppendOnlyJsonlErrorCode,
  type JsonlReplay,
} from './platform/filesystem/append-only-jsonl.js'
export {
  ResourceRevisionSchema,
  calculateResourceRevision,
  readResourceRevision,
  type ResourceRevision,
} from './platform/filesystem/resource-revision.js'
export {
  createResourceWatcher,
  type ResourceChangeEvent,
  type ResourceChangeType,
  type ResourceWatcher,
  type WatchDirectory,
  type WatchedResource,
  type WatchedResourceInventory,
} from './platform/filesystem/resource-watcher.js'
export {
  createManagedJsonSchemas,
  publishManagedJsonSchemas,
  type ManagedJsonSchema,
} from './platform/filesystem/schema-publisher.js'
export {
  SettingsCredentialReferenceSchema,
  SettingsGitConnectionRecordSchema,
  SettingsRecordSchema,
  SettingsRevisionSchema,
  SettingsStoreError,
  type SettingsCredentialReference,
  type SettingsGitConnectionRecord,
  type SettingsRecord,
  type SettingsRevision,
  type SettingsStore,
  type SettingsStoreErrorCode,
  type VersionedSettingsRecord,
  type WriteSettingsInput,
} from './modules/settings/settings-store.js'
export { createFilesystemSettingsStore } from './modules/settings/filesystem-settings-store.js'
export {
  createSettingsService,
  type SettingsService,
  type UpdateSettingsAppearanceInput,
} from './modules/settings/settings-service.js'
export {
  createFilesystemGitConnectionRepository,
  gitCredentialReference,
} from './modules/repository/git/filesystem-git-connection-repository.js'
export {
  GitConnectionServiceError,
  createGitConnectionService,
  type GitConnectionService,
  type GitConnectionServiceErrorCode,
} from './modules/repository/git/git-connection-service.js'
export {
  createGitCredentialHelperCommand,
  gitCredentialHelperPath,
  handleGitCredentialRequest,
  parseGitCredentialInput,
  type GitCredentialAction,
  type GitCredentialInput,
  type GitCredentialTokenReader,
} from './modules/repository/git/git-credential-helper.js'
export {
  type GitConnectionRecord,
  type GitConnectionRepository,
} from './modules/repository/git/git-connection-repository.js'
export { type GitSecretStore } from './modules/repository/git/git-secret-store.js'
export {
  createBunGitSecretStore,
  type BunSecretsAdapter,
} from './modules/repository/git/bun-git-secret-store.js'
export {
  type RemoteGitAccount,
  type RemoteGitHost,
  type RemoteGitRepositoryReference,
} from './modules/repository/git/remote-git-host.js'
export {
  RemoteGitHostError,
  createFetchRemoteGitHost,
} from './modules/repository/git/fetch-remote-git-host.js'
export {
  HarnessCatalogError,
  createHarnessCatalog,
  type AvailableHarnessDescriptor,
  type HarnessCatalog,
  type HarnessCatalogErrorCode,
  type HarnessInspector,
} from './modules/harness/harness-catalog.js'
export {
  createHarnessService,
  type HarnessAdapter,
  type HarnessService,
} from './modules/harness/harness-service.js'
export {
  AgentTraceStoreError,
  createRunFilesystemAgentTraceStore,
  type AgentTraceStore,
  type AgentTraceStoreErrorCode,
  type RunAgentTraceContext,
  type RunAgentTraceReadInput,
  type RunAgentTraceStore,
} from './modules/run/traces/filesystem-agent-trace-store.js'
export {
  createAgentNodeRunner,
  type AgentNodeRunRecord,
} from './modules/run/orchestration/agent-node-runner.js'
export {
  RepositoryServiceError,
  createRepositoryService,
  type RepositoryService,
  type RepositoryServiceErrorCode,
} from './modules/repository/repositories/repository-service.js'
export {
  RepositoryCollectionSchema,
  RepositoryRecordSchema,
  RepositoryStoreError,
  type RepositoryCollection,
  type RepositoryRecord,
  type RepositoryStore,
  type RepositoryStoreErrorCode,
} from './modules/repository/repositories/repository-store.js'
export { createFilesystemRepositoryStore } from './modules/repository/repositories/filesystem-repository-store.js'
export {
  WorkflowStoreError,
  type VersionedWorkflowFile,
  type WorkflowStore,
  type WorkflowStoreEntry,
  type WorkflowStoreErrorCode,
} from './modules/workflow/workflows/workflow-store.js'
export {
  invalidWorkflowSource,
  parseWorkflowSource,
  workflowDiagnostic,
  type WorkflowDiagnostic,
  type WorkflowDiagnosticCode,
  type WorkflowSource,
} from './modules/workflow/workflows/workflow-source.js'
export { createFilesystemWorkflowStore } from './modules/workflow/workflows/filesystem-workflow-store.js'
export { createRemoteRunRepositoryResolver } from './modules/repository/repositories/remote-run-repository-resolver.js'
export {
  createNativeGitRunWorkspaceProvisioner,
  type CreateNativeGitRunWorkspaceProvisionerOptions,
} from './modules/run/workspaces/native-git-run-workspace-provisioner.js'
export {
  createFilesystemGitRunWorkspaceProvisioner,
  type CreateFilesystemGitRunWorkspaceProvisionerOptions,
} from './modules/run/workspaces/filesystem-git-run-workspace-provisioner.js'
export {
  RunWorkspaceProvisioningError,
  type FilesystemRunWorkspaceProvisioner,
  type ProvisionedFilesystemRunRepository,
  type ProvisionedRunRepository,
  type RunWorkspaceProvisioner,
  type RunWorkspaceProvisioningFailure,
} from './modules/run/workspaces/run-workspace-provisioner.js'
export {
  type NodeRunInput,
  type NodeRunResult,
  type NodeRunner,
} from './modules/run/orchestration/node-runner.js'
export {
  createFilesystemJournalCoordinatorStore,
  type JournalCoordinatorRun,
  type JournalCoordinatorStore,
} from './modules/run/orchestration/journal-coordinator-store.js'
export {
  JournalCoordinatorError,
  createJournalWorkflowCoordinator,
  type JournalCoordinatorErrorCode,
  type JournalWorkflowCoordinator,
} from './modules/run/orchestration/journal-workflow-coordinator.js'
export {
  JournalExecutionWorkerError,
  createJournalExecutionWorker,
  type JournalExecutionWorker,
  type JournalExecutionWorkerErrorCode,
  type JournalRunLocator,
} from './modules/run/orchestration/journal-execution-worker.js'
export {
  createScheduledNodeClaims,
  type ScheduledNodeClaim,
  type ScheduledNodeClaims,
} from './modules/run/orchestration/scheduled-node-claims.js'
export { type JsonPrimitive, type JsonValue } from './platform/json-value.js'
export {
  createProcessRunner,
  type CreateProcessRunnerOptions,
  type ProcessRunInput,
  type ProcessRunResult,
  type ProcessRunner,
} from './platform/processes/process-runner.js'
export {
  JournalCancellationServiceError,
  createJournalCancellationService,
  type JournalCancellationService,
  type JournalCancellationServiceErrorCode,
} from './modules/run/services/journal-cancellation-service.js'
export {
  RunServiceError,
  createFilesystemRunAdmissionService,
  type CreateFilesystemRunAdmissionServiceOptions,
  type CreateRunServiceInput,
  type FilesystemRunAdmissionService,
  type FilesystemRunRepositoryResolution,
  type RunServiceErrorCode,
  type RunRepositoryResolution,
} from './modules/run/services/run-service.js'
export {
  WorkflowServiceError,
  type WorkflowServiceErrorCode,
} from './modules/workflow/services/workflow-error.js'
export {
  createWorkflowDefinitionService,
  type WorkflowDefinitionCatalogEntry,
  type WorkflowDefinitionService,
  type WorkflowRunActivity,
  type WorkflowReadinessCode,
  type WorkflowReadinessFinding,
} from './modules/workflow/services/workflow-definition-service.js'
export {
  ResourceEventFeedError,
  createResourceEventFeed,
  type CreateResourceEventFeedOptions,
  type PublishResourceChangeInput,
  type ResourceEventFeed,
  type SubscribeToResourceEventsInput,
} from './platform/services/resource-event-feed.js'
