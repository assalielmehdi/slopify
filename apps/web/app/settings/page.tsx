import type { Metadata } from 'next'

import { ProjectProfileSettings } from '@/components/settings/project-profile-settings'
import { ConnectionSettings } from '@/components/settings/connection-settings'

export const metadata: Metadata = {
  title: 'Settings',
}

export default function SettingsPage() {
  return (
    <div className="grid gap-10">
      <ConnectionSettings />
      <ProjectProfileSettings />
    </div>
  )
}
