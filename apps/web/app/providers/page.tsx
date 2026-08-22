import type { Metadata } from 'next'

import { ConnectionSettings } from '@/components/settings/connection-settings'

export const metadata: Metadata = { title: 'Providers' }

export default function ProvidersPage() {
  return <ConnectionSettings kind="providers" />
}
