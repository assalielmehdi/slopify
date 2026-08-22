export const displayRunId = (runId: string): string =>
  runId.startsWith('run-') ? runId.slice('run-'.length) : runId
