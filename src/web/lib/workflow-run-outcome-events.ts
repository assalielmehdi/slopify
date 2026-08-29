export const WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT = 'slopify:workflow-run-outcomes-changed'

export function announceWorkflowRunOutcomesChanged(): void {
  window.dispatchEvent(new Event(WORKFLOW_RUN_OUTCOMES_CHANGED_EVENT))
}
