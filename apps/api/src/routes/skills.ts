import { SkillCatalogError, type SkillCatalog, type SkillRecord } from '@slopify/execution-runtime'
import type { Hono } from 'hono'
import { z } from 'zod'

import { parseJsonBody } from '../api-error.js'

const CreateSkillSchema = z.strictObject({
  markdown: z.string().min(1).max(5_000_000),
})
const UpdateSkillSchema = z.strictObject({
  expectedDigest: z.string().length(64),
  files: z.record(z.string(), z.string()),
})
const DeleteSkillSchema = z.strictObject({ expectedDigest: z.string().length(64) })

export interface BuiltInSkillPresentation {
  readonly displayName: string
  readonly kind: 'built-in' | 'connector'
}

const decorate = (
  skill: SkillRecord,
  builtInSkills: ReadonlyMap<string, BuiltInSkillPresentation>,
) => {
  const presentation = builtInSkills.get(skill.skillId)
  return {
    ...skill,
    ...(presentation === undefined ? {} : { displayName: presentation.displayName }),
    kind: presentation?.kind ?? 'user',
    readOnly: presentation !== undefined,
  }
}

export const registerSkillRoutes = (
  app: Hono,
  skills: SkillCatalog,
  builtInSkills: ReadonlyMap<string, BuiltInSkillPresentation> = new Map(),
): void => {
  app.get('/api/skills', async (context) =>
    context.json(
      { skills: (await skills.refresh()).map((skill) => decorate(skill, builtInSkills)) },
      200,
    ),
  )
  app.get('/api/skills/:skillId', async (context) =>
    context.json(decorate(await skills.get(context.req.param('skillId')), builtInSkills), 200),
  )
  app.post('/api/skills', async (context) => {
    const input = CreateSkillSchema.parse(await parseJsonBody(context))
    return context.json(decorate(await skills.create(input), builtInSkills), 201)
  })
  app.put('/api/skills/:skillId', async (context) => {
    const skillId = context.req.param('skillId')
    if (builtInSkills.has(skillId)) throw new SkillCatalogError('SKILL_READ_ONLY')
    return context.json(
      decorate(
        await skills.update(skillId, UpdateSkillSchema.parse(await parseJsonBody(context))),
        builtInSkills,
      ),
      200,
    )
  })
  app.delete('/api/skills/:skillId', async (context) => {
    if (builtInSkills.has(context.req.param('skillId')))
      throw new SkillCatalogError('SKILL_READ_ONLY')
    await skills.delete(
      context.req.param('skillId'),
      DeleteSkillSchema.parse(await parseJsonBody(context)),
    )
    return context.body(null, 204)
  })
}
