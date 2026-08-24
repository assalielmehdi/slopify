import type { GitProvider } from '@slopify/contracts'

export interface GitSecretStore {
  get(provider: GitProvider): Promise<string | null>
  set(provider: GitProvider, token: string): Promise<void>
  delete(provider: GitProvider): Promise<boolean>
}
