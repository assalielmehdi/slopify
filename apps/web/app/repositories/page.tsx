import type { Metadata } from 'next'

import { RepositorySettings } from '@/components/settings/repository-settings'

export const metadata: Metadata = { title: 'Repositories' }

export default function RepositoriesPage() {
  return <RepositorySettings />
}
