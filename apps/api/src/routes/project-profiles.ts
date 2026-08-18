import {
  ProjectProfileServiceError,
  type ProjectProfileService,
  type ReadinessService,
} from '@loop/execution-runtime'
import type { Context, Hono } from 'hono'

const parseProfileBody = async (context: Context): Promise<unknown> => {
  try {
    return await context.req.json<unknown>()
  } catch (cause) {
    throw new ProjectProfileServiceError('PROFILE_INVALID', 'Project profile is invalid', {
      cause,
    })
  }
}

export const registerProjectProfileRoutes = (
  app: Hono,
  services: {
    readonly profiles: ProjectProfileService
    readonly readiness: ReadinessService
  },
): void => {
  app.get('/api/project-profiles', (context) =>
    context.json({ profiles: services.profiles.list() }, 200),
  )

  app.post('/api/project-profiles', async (context) => {
    const profile = services.profiles.save(await parseProfileBody(context))
    return context.json(profile, 201)
  })

  app.put('/api/project-profiles/:profileId', async (context) => {
    const profileId = context.req.param('profileId')
    const body = await parseProfileBody(context)
    if (
      typeof body !== 'object' ||
      body === null ||
      !('profileId' in body) ||
      body.profileId !== profileId
    ) {
      throw new ProjectProfileServiceError(
        'PROFILE_INVALID',
        'Path profile ID must match the request body',
      )
    }
    return context.json(services.profiles.save(body), 200)
  })

  app.get('/api/project-profiles/:profileId/readiness', async (context) =>
    context.json(await services.readiness.check(context.req.param('profileId')), 200),
  )

  app.get('/api/connectors/status', (context) =>
    context.json(services.readiness.connectorStatus(), 200),
  )
}
