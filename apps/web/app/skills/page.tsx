import type { Metadata } from 'next'

import { SkillsManager } from '@/components/skills/skills-manager'

export const metadata: Metadata = { title: 'Skills' }

export default function SkillsPage() {
  return <SkillsManager />
}
