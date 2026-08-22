import type { Metadata } from 'next'

import { ConnectionSettings } from '@/components/settings/connection-settings'

export const metadata: Metadata = { title: 'Connectors' }

export default async function ConnectorsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const connection = (await searchParams).connection
  return (
    <ConnectionSettings
      kind="connectors"
      {...(typeof connection === 'string' ? { initialConnectionId: connection } : {})}
    />
  )
}
