import type { ProjectProfileCatalogResponse } from '@loop/contracts'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { WorkflowCatalogEntry } from '@/lib/api-client'

export interface RunConfigurationFieldsProps {
  readonly catalog: ProjectProfileCatalogResponse
  readonly notes: string
  readonly onNotesChange: (notes: string) => void
  readonly onProfileChange: (profileId: string) => void
  readonly onResolveTask: () => void
  readonly onRevisionChange: (revisionId: string) => void
  readonly onTaskReferenceChange: (taskReference: string) => void
  readonly onWorkflowChange: (workflowId: string) => void
  readonly profileError?: string | undefined
  readonly profileId: string
  readonly readinessPending: boolean
  readonly resolving: boolean
  readonly revisionError?: string | undefined
  readonly revisionId: string
  readonly selectedWorkflow?: WorkflowCatalogEntry | undefined
  readonly taskError?: string | undefined
  readonly taskReference: string
  readonly workflowId: string
  readonly workflows: readonly WorkflowCatalogEntry[]
}

export function RunConfigurationFields({
  catalog,
  notes,
  onNotesChange,
  onProfileChange,
  onResolveTask,
  onRevisionChange,
  onTaskReferenceChange,
  onWorkflowChange,
  profileError,
  profileId,
  readinessPending,
  resolving,
  revisionError,
  revisionId,
  selectedWorkflow,
  taskError,
  taskReference,
  workflowId,
  workflows,
}: RunConfigurationFieldsProps) {
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="workflow">Workflow</FieldLabel>
        <NativeSelect
          id="workflow"
          onChange={(event) => onWorkflowChange(event.currentTarget.value)}
          value={workflowId}
        >
          {workflows.map((workflow) => (
            <NativeSelectOption key={workflow.workflowId} value={workflow.workflowId}>
              {workflow.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field data-invalid={revisionError !== undefined}>
        <FieldLabel htmlFor="revision">Workflow revision</FieldLabel>
        <NativeSelect
          aria-describedby={revisionError === undefined ? undefined : 'revision-error'}
          aria-invalid={revisionError !== undefined}
          id="revision"
          onChange={(event) => onRevisionChange(event.currentTarget.value)}
          value={revisionId}
        >
          {selectedWorkflow?.revisions.map((revision) => (
            <NativeSelectOption key={revision.revisionId} value={revision.revisionId}>
              {revision.revisionId}
              {revision.revisionId === selectedWorkflow.latestRevisionId ? ' · Latest' : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldError id="revision-error">{revisionError}</FieldError>
      </Field>
      <Field data-invalid={profileError !== undefined}>
        <FieldLabel htmlFor="profile">Project profile</FieldLabel>
        <NativeSelect
          aria-describedby={profileError === undefined ? undefined : 'profile-error'}
          aria-invalid={profileError !== undefined}
          disabled={readinessPending}
          id="profile"
          onChange={(event) => onProfileChange(event.currentTarget.value)}
          value={profileId}
        >
          {catalog.profiles.map((profile) => (
            <NativeSelectOption key={profile.profileId} value={profile.profileId}>
              {profile.displayName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {readinessPending ? <FieldDescription>Checking readiness…</FieldDescription> : null}
        <FieldError id="profile-error">{profileError}</FieldError>
      </Field>
      <Field data-invalid={taskError !== undefined}>
        <FieldLabel htmlFor="task-reference">ClickUp task ID or URL</FieldLabel>
        <div className="flex gap-2">
          <Input
            aria-describedby={taskError === undefined ? undefined : 'task-reference-error'}
            aria-invalid={taskError !== undefined}
            id="task-reference"
            maxLength={512}
            onChange={(event) => onTaskReferenceChange(event.currentTarget.value)}
            placeholder="86abc123 or https://app.clickup.com/t/86abc123"
            value={taskReference}
          />
          <Button disabled={resolving || profileId === ''} onClick={onResolveTask} type="button">
            {resolving ? 'Resolving…' : 'Resolve task'}
          </Button>
        </div>
        <FieldError id="task-reference-error">{taskError}</FieldError>
      </Field>
      <Field className="md:col-span-2">
        <FieldLabel htmlFor="run-notes">Run notes</FieldLabel>
        <Textarea
          id="run-notes"
          maxLength={2_000}
          onChange={(event) => onNotesChange(event.currentTarget.value)}
          placeholder="Optional operator context; workflow semantics stay unchanged."
          value={notes}
        />
      </Field>
    </FieldGroup>
  )
}
