export const WORKFLOW_CATALOG_CHANGED_EVENT = 'slopify:workflow-catalog-changed'

export function announceWorkflowCatalogChanged(): void {
  window.dispatchEvent(new Event(WORKFLOW_CATALOG_CHANGED_EVENT))
}
