import type { Metadata } from 'next'

import { ProjectSettings } from '@/components/settings/project-settings'

export const metadata: Metadata = { title: 'Projects' }

export default function ProjectsPage() {
  return <ProjectSettings />
}
