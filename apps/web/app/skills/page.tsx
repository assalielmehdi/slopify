import type { Metadata } from 'next'

import { SkillsManager } from '@/components/skills/skills-manager'

export const metadata: Metadata = { title: 'Skills' }

export default async function SkillsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const skill = (await searchParams).skill
  return <SkillsManager {...(typeof skill === 'string' ? { initialSkillId: skill } : {})} />
}
