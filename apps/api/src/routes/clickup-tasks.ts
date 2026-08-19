import { ResolveClickUpTaskRequestSchema } from '@loop/contracts'
import {
  ProjectProfileServiceError,
  RunServiceError,
  type ProjectProfileService,
  type RunTaskResolver,
} from '@loop/execution-runtime'
import type { Hono } from 'hono'
import { z } from 'zod'

import { parseJsonBody } from '../api-error.js'

export const registerClickUpTaskRoutes = (
  app: Hono,
  services: {
    readonly profiles: ProjectProfileService
    readonly tasks: RunTaskResolver
  },
): void => {
  app.post('/api/clickup/tasks/resolve', async (context) => {
    const input = ResolveClickUpTaskRequestSchema.parse(await parseJsonBody(context))
    const profile = services.profiles.get(input.profileId)
    if (profile === undefined) {
      throw new ProjectProfileServiceError('PROFILE_NOT_FOUND', 'Project profile was not found')
    }

    try {
      const snapshot = z.json().parse(
        await services.tasks.resolve(input.taskReference, {
          clickupWorkspaceId: profile.clickupWorkspaceId,
        }),
      )
      return context.body(JSON.stringify(snapshot), 200, {
        'content-type': 'application/json; charset=UTF-8',
      })
    } catch (cause) {
      throw new RunServiceError('TASK_RESOLUTION_FAILED', 'Task could not be resolved', { cause })
    }
  })
}
