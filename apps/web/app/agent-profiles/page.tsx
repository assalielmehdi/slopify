import type { Metadata } from 'next'

import { BotIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Agent profiles' }

export default function AgentProfilesPage() {
  return (
    <section className="flex min-h-[28rem] w-full items-center justify-center">
      <section className="flex max-w-lg flex-col items-center text-center">
        <span className="mb-5 flex size-12 items-center justify-center rounded-lg border bg-card text-primary">
          <BotIcon aria-hidden="true" className="size-5" />
        </span>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Default agent</h2>
          <Badge variant="outline">Workflow-owned</Badge>
        </div>
        <p className="mt-3 max-w-[52ch] text-sm/6 text-muted-foreground">
          Agent jobs currently keep their provider, model, skills, connectors, and sandbox in the
          immutable workflow revision. Reusable persisted profiles are not configured yet.
        </p>
      </section>
    </section>
  )
}
