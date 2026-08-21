import type { ConnectorStatus, ProjectProfileReadiness } from '@loop/contracts'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const categoryLabels: Record<
  ProjectProfileReadiness['repositories'][number]['findings'][number]['category'],
  string
> = {
  filesystem: 'Filesystem',
  git: 'Git',
  tool: 'Required tools',
  clickup: 'ClickUp',
  gitlab: 'GitLab',
  'model-provider': 'Model provider',
}

const connectorRows = (connectors: ConnectorStatus) =>
  [
    ['ClickUp', connectors.clickup],
    ['GitLab', connectors.gitlab],
    ['Model provider', connectors.modelProvider],
  ] as const

export interface ReadinessPanelProps {
  readonly connectors: ConnectorStatus
  readonly readiness?: ProjectProfileReadiness | undefined
  readonly repositoryNames: Readonly<Record<string, string>>
  readonly pending?: boolean
}

export function ReadinessPanel({
  connectors,
  readiness,
  repositoryNames,
  pending = false,
}: ReadinessPanelProps) {
  return (
    <section aria-labelledby="readiness-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="readiness-heading" className="font-heading text-base font-semibold">
          Runtime readiness
        </h2>
        <p className="text-sm/5 text-muted-foreground">
          Connection state and repository checks are reported without private values.
        </p>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Connector status</CardTitle>
          <CardDescription>
            Availability only; private values remain outside this response.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2">
            {connectorRows(connectors).map(([label, connected]) => (
              <div className="flex items-center justify-between gap-3" key={label}>
                <dt>{label}</dt>
                <dd>
                  <Badge variant={connected ? 'secondary' : 'outline'}>
                    {connected ? 'Connected' : 'Not connected'}
                  </Badge>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div aria-live="polite" className="grid gap-3">
        {pending ? <p className="text-xs text-muted-foreground">Checking readiness…</p> : null}
        {!pending && readiness === undefined ? (
          <p className="text-xs text-muted-foreground">Save or select a profile to check it.</p>
        ) : null}
        {readiness?.repositories.map((repository) => {
          const name = repositoryNames[repository.repositoryId] ?? repository.repositoryId
          return (
            <Card
              aria-label={`${name} readiness`}
              key={repository.repositoryId}
              role="group"
              size="sm"
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span>{name}</span>
                  <Badge variant={repository.ready ? 'secondary' : 'destructive'}>
                    {repository.ready ? 'Ready' : 'Needs attention'}
                  </Badge>
                </CardTitle>
                <CardDescription>{repository.repositoryId}</CardDescription>
              </CardHeader>
              <CardContent>
                {repository.findings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">All configured checks passed.</p>
                ) : (
                  <ul className="grid gap-2">
                    {repository.findings.map((finding, index) => (
                      <li
                        className="border-l-2 border-destructive pl-2"
                        key={`${finding.code}-${index}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{categoryLabels[finding.category]}</Badge>
                          <code className="text-[0.6875rem] text-muted-foreground">
                            {finding.code}
                          </code>
                        </div>
                        <p className="mt-1 text-sm/5">{finding.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
