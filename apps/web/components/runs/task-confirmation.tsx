import type { ProjectProfileConfiguration } from '@loop/contracts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ClickUpTaskSnapshot } from '@/lib/api-client'

export interface TaskConfirmationProps {
  readonly confirmed: boolean
  readonly onConfirmedChange: (confirmed: boolean) => void
  readonly profile: ProjectProfileConfiguration
  readonly profileReady: boolean
  readonly revisionId: string
  readonly task: ClickUpTaskSnapshot
  readonly workflowName: string
}

export function TaskConfirmation({
  confirmed,
  onConfirmedChange,
  profile,
  profileReady,
  revisionId,
  task,
  workflowName,
}: TaskConfirmationProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-heading text-sm font-medium">{task.title}</h2>
        </CardTitle>
        <CardDescription>
          <a href={task.url} rel="noreferrer" target="_blank">
            {task.customTaskId ?? task.taskId}
          </a>{' '}
          · {task.status.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Workflow</dt>
            <dd className="font-medium">{workflowName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Revision</dt>
            <dd className="font-mono text-sm">{revisionId}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Project profile</dt>
            <dd className="font-medium">{profile.displayName}</dd>
          </div>
        </dl>

        <div>
          <h3 className="mb-2 font-medium">Candidate repositories and targets</h3>
          <ol className="divide-y overflow-hidden rounded-md border">
            {profile.repositories.map((repository) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                key={repository.repositoryId}
              >
                <div>
                  <p className="font-medium">{repository.displayName}</p>
                  <p className="text-muted-foreground">{repository.purpose}</p>
                </div>
                <Badge variant="outline">Target {repository.targetBranch}</Badge>
              </li>
            ))}
          </ol>
        </div>

        <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm/5">
          <input
            checked={confirmed}
            className="mt-0.5 size-4 accent-primary"
            disabled={!profileReady}
            onChange={(event) => onConfirmedChange(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>I confirm this task, revision, profile, candidates, and targets.</span>
        </label>
      </CardContent>
    </Card>
  )
}
