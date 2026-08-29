import { GitProviderSchema, type GitProvider } from '@slopify/shared'

import type { GitSecretStore } from './git-secret-store.js'

const SERVICE = 'dev.slopify.git'
const credentialName = (provider: GitProvider): string =>
  provider === 'GITHUB' ? 'github.com' : 'gitlab.com'
const options = (provider: GitProvider) => ({ service: SERVICE, name: credentialName(provider) })

export interface BunSecretsAdapter {
  get(input: Readonly<{ service: string; name: string }>): Promise<string | null>
  set(input: Readonly<{ service: string; name: string; value: string }>): Promise<void>
  delete(input: Readonly<{ service: string; name: string }>): Promise<boolean>
}

export const createBunGitSecretStore = (
  input: Readonly<{ secrets?: BunSecretsAdapter }> = {},
): GitSecretStore => {
  const secrets = input.secrets ?? Bun.secrets
  return {
    get(providerInput) {
      return secrets.get(options(GitProviderSchema.parse(providerInput)))
    },
    set(providerInput, token) {
      return secrets.set({ ...options(GitProviderSchema.parse(providerInput)), value: token })
    },
    delete(providerInput) {
      return secrets.delete(options(GitProviderSchema.parse(providerInput)))
    },
  }
}
