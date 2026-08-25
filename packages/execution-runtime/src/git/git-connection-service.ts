import {
  ConfigureGitConnectionRequestSchema,
  GitConnectionSchema,
  GitProviderSchema,
  type GitConnection,
  type GitProvider,
  type GitRepository,
} from '@slopify/contracts'

import type { GitConnectionRepository } from './git-connection-repository.js'
import type { GitSecretStore } from './git-secret-store.js'
import type { RemoteGitHost } from './remote-git-host.js'

export type GitConnectionServiceErrorCode =
  | 'GIT_CONNECTION_INVALID'
  | 'GIT_CONNECTION_NOT_FOUND'
  | 'GIT_CONNECTION_CREDENTIAL_MISSING'
  | 'GIT_PROVIDER_UNAVAILABLE'

export class GitConnectionServiceError extends Error {
  override readonly name = 'GitConnectionServiceError'

  constructor(
    readonly code: GitConnectionServiceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface GitConnectionService {
  configure(provider: unknown, input: unknown): Promise<GitConnection>
  disconnect(provider: unknown): Promise<void>
  list(): Promise<readonly GitConnection[]>
  listRepositories(provider: unknown): Promise<readonly GitRepository[]>
  requireToken(provider: GitProvider): Promise<string>
}

export const createGitConnectionService = (
  options: Readonly<{
    connections: GitConnectionRepository
    secrets: GitSecretStore
    remote: RemoteGitHost
    now?: () => string
  }>,
): GitConnectionService => {
  const now = options.now ?? (() => new Date().toISOString())

  const restoreSecret = async (provider: GitProvider, token: string | null): Promise<void> => {
    if (token === null) await options.secrets.delete(provider)
    else await options.secrets.set(provider, token)
  }

  const requireToken = async (provider: GitProvider): Promise<string> => {
    if ((await options.connections.get(provider)) === undefined) {
      throw new GitConnectionServiceError(
        'GIT_CONNECTION_NOT_FOUND',
        `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} is not connected`,
      )
    }
    const token = await options.secrets.get(provider)
    if (token === null || token.trim() === '') {
      throw new GitConnectionServiceError(
        'GIT_CONNECTION_CREDENTIAL_MISSING',
        `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} credential is unavailable`,
      )
    }
    return token
  }

  return {
    async configure(providerInput, input) {
      const provider = GitProviderSchema.parse(providerInput)
      const { token } = ConfigureGitConnectionRequestSchema.parse(input)
      let account
      try {
        account = await options.remote.authenticate(provider, token)
      } catch {
        throw new GitConnectionServiceError(
          'GIT_CONNECTION_INVALID',
          `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} rejected the personal access token`,
        )
      }
      const previous = await options.connections.get(provider)
      const previousToken = await options.secrets.get(provider)
      const timestamp = now()
      const connection = GitConnectionSchema.parse({
        provider,
        accountUsername: account.accountUsername,
        connectedAt: previous?.connectedAt ?? timestamp,
        updatedAt: timestamp,
      })
      await options.secrets.set(provider, token)
      try {
        await options.connections.save(connection)
      } catch (cause) {
        await restoreSecret(provider, previousToken)
        throw cause
      }
      return connection
    },

    async disconnect(providerInput) {
      const provider = GitProviderSchema.parse(providerInput)
      const previous = await options.connections.get(provider)
      const previousToken = await options.secrets.get(provider)
      if (previous === undefined) {
        await options.secrets.delete(provider)
        return
      }

      const deleted = await options.connections.delete(provider)
      try {
        await options.secrets.delete(provider)
      } catch (cause) {
        if (deleted) await options.connections.save(previous)
        await restoreSecret(provider, previousToken)
        throw cause
      }
    },

    async list() {
      return (await options.connections.list()).map((connection) =>
        GitConnectionSchema.parse(connection),
      )
    },

    async listRepositories(providerInput) {
      const provider = GitProviderSchema.parse(providerInput)
      const token = await requireToken(provider)
      try {
        return await options.remote.listRepositories(provider, token)
      } catch {
        throw new GitConnectionServiceError(
          'GIT_PROVIDER_UNAVAILABLE',
          `${provider === 'GITHUB' ? 'GitHub' : 'GitLab'} repositories could not be loaded`,
        )
      }
    },

    requireToken,
  }
}
