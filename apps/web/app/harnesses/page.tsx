import type { Metadata } from 'next'

import { HarnessSettings } from '@/components/settings/harness-settings'

export const metadata: Metadata = { title: 'Harnesses' }

export default function HarnessesPage() {
  return <HarnessSettings />
}
