import type { SkillCatalog } from '@slopify/execution-runtime'
import type { Hono } from 'hono'
import { z } from 'zod'

import { parseJsonBody } from '../api-error.js'

const CreateSkillSchema = z.strictObject({
  skillId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  files: z.record(z.string(), z.string()).optional(),
})
const UpdateSkillSchema = z.strictObject({
  expectedDigest: z.string().length(64),
  files: z.record(z.string(), z.string()),
})
const DeleteSkillSchema = z.strictObject({ expectedDigest: z.string().length(64) })

export const registerSkillRoutes = (app: Hono, skills: SkillCatalog): void => {
  app.get('/api/skills', async (context) => context.json({ skills: await skills.refresh() }, 200))
  app.get('/api/skills/:skillId', async (context) =>
    context.json(await skills.get(context.req.param('skillId')), 200),
  )
  app.post('/api/skills', async (context) => {
    const input = CreateSkillSchema.parse(await parseJsonBody(context))
    return context.json(
      await skills.create({
        skillId: input.skillId,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        ...(input.files === undefined ? {} : { files: input.files }),
      }),
      201,
    )
  })
  app.put('/api/skills/:skillId', async (context) =>
    context.json(
      await skills.update(
        context.req.param('skillId'),
        UpdateSkillSchema.parse(await parseJsonBody(context)),
      ),
      200,
    ),
  )
  app.delete('/api/skills/:skillId', async (context) => {
    await skills.delete(
      context.req.param('skillId'),
      DeleteSkillSchema.parse(await parseJsonBody(context)),
    )
    return context.body(null, 204)
  })
}
