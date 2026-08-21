import type { Metadata } from 'next'

import { ConnectionSettings } from '@/components/settings/connection-settings'

export const metadata: Metadata = { title: 'Connectors' }

export default function ConnectorsPage() {
  return <ConnectionSettings kind="connectors" />
}
