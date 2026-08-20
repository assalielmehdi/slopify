import type { Metadata } from 'next'

import { ProjectProfileSettings } from '@/components/settings/project-profile-settings'

export const metadata: Metadata = {
  title: 'Settings',
}

export default function SettingsPage() {
  return <ProjectProfileSettings />
}
