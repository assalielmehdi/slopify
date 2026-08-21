import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Project profiles',
}

export default function SettingsPage() {
  redirect('/project-profiles')
}
