import type { Metadata } from 'next'

import { ProjectProfileSettings } from '@/components/settings/project-profile-settings'

export const metadata: Metadata = { title: 'Project profiles' }

export default function ProjectProfilesPage() {
  return <ProjectProfileSettings />
}
