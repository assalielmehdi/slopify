import type { Metadata } from 'next'

import { StartRunForm } from '@/components/runs/start-run-form'

export const metadata: Metadata = {
  title: 'Start a run',
}

export default function NewRunPage() {
  return <StartRunForm />
}
