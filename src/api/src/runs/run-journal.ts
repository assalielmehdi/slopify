import type { AppendOnlyJsonlErrorCode } from '../filesystem/append-only-jsonl.js'
import type { RunProjectionState } from './run-projection.js'
import type { RunDomainEvent } from './run-events.js'

export type NewRunDomainEvent = RunDomainEvent extends infer Event
  ? Event extends RunDomainEvent
    ? Omit<Event, 'schemaVersion' | 'runId' | 'sequence'>
    : never
  : never

export type RunJournalDiagnosticCode =
  AppendOnlyJsonlErrorCode | 'DUPLICATE_EVENT_ID' | 'EVENT_SEMANTICS_INVALID'

export interface RunJournalDiagnostic {
  readonly code: RunJournalDiagnosticCode
  readonly message: string
  readonly lineNumber: number | undefined
}

export type RunJournalReplay =
  | Readonly<{
      status: 'READY'
      events: readonly RunDomainEvent[]
      recoveredBytes: number
    }>
  | Readonly<{
      status: 'CORRUPT'
      diagnostic: RunJournalDiagnostic
    }>

export type RunProjectionRepair =
  | Readonly<{
      status: 'READY'
      events: readonly RunDomainEvent[]
      recoveredBytes: number
      projection: RunProjectionState
      repaired: boolean
    }>
  | Extract<RunJournalReplay, { readonly status: 'CORRUPT' }>

export type RunJournalErrorCode = 'RUN_EVENT_CONFLICT' | 'RUN_JOURNAL_CORRUPT'

export class RunJournalError extends Error {
  override readonly name = 'RunJournalError'

  constructor(
    readonly code: RunJournalErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface RunJournal {
  append(event: NewRunDomainEvent): Promise<RunDomainEvent>
  replay(): Promise<RunJournalReplay>
  repairProjections(): Promise<RunProjectionRepair>
}
