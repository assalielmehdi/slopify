import {
  InMemoryCredentialStore,
  type Credential,
  type OAuthCredential,
} from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'

const transactionId = z
  .string()
  .regex(/^[a-z0-9-]+$/u)
  .max(256)

export type ChatGptOAuthTransaction =
  | Readonly<{ id: string; status: 'PENDING'; authorizationUrl?: string; instructions?: string }>
  | Readonly<{ id: string; status: 'CONNECTED'; connectionId: string }>
  | Readonly<{ id: string; status: 'FAILED'; message: string }>
  | Readonly<{ id: string; status: 'CANCELLED' }>

export interface ChatGptOAuthService {
  start(input: Readonly<{ label: string }>): ChatGptOAuthTransaction
  get(id: string): ChatGptOAuthTransaction | undefined
  cancel(id: string): boolean
}

export interface ChatGptOAuthLoginInteraction {
  readonly signal: AbortSignal
  notify(
    event: Readonly<{
      type: string
      url?: string
      instructions?: string
    }>,
  ): void
}

const defaultLogin = async (interaction: ChatGptOAuthLoginInteraction): Promise<Credential> => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  return runtime.login('openai-codex', 'oauth', {
    signal: interaction.signal,
    notify: interaction.notify,
    async prompt() {
      throw new Error('Interactive authorization-code entry is unavailable')
    },
  })
}

export const createChatGptOAuthService = (
  options: Readonly<{
    connect(input: Readonly<{ label: string; credential: OAuthCredential }>): Promise<string>
    login?: (interaction: ChatGptOAuthLoginInteraction) => Promise<Credential>
    createTransactionId?: () => string
  }>,
): ChatGptOAuthService => {
  const transactions = new Map<
    string,
    { value: ChatGptOAuthTransaction; controller: AbortController }
  >()
  const createTransactionId =
    options.createTransactionId ?? (() => `chatgpt-oauth-${crypto.randomUUID()}`)
  const login = options.login ?? defaultLogin

  return {
    start(input) {
      const label = input.label.trim()
      if (label.length === 0 || label.length > 128)
        throw new TypeError('Connection label is invalid')
      const id = transactionId.parse(createTransactionId())
      const controller = new AbortController()
      const transaction = { id, status: 'PENDING' as const }
      transactions.set(id, { value: transaction, controller })
      void login({
        signal: controller.signal,
        notify(event) {
          if (event.type !== 'auth_url' || event.url === undefined) return
          const current = transactions.get(id)
          if (current?.value.status !== 'PENDING') return
          current.value = {
            id,
            status: 'PENDING',
            authorizationUrl: event.url,
            ...(event.instructions === undefined ? {} : { instructions: event.instructions }),
          }
        },
      })
        .then(async (credential) => {
          if (credential.type !== 'oauth') throw new TypeError('ChatGPT login did not return OAuth')
          const current = transactions.get(id)
          if (current?.value.status !== 'PENDING') return
          const connectionId = await options.connect({ label, credential })
          current.value = { id, status: 'CONNECTED', connectionId }
        })
        .catch(() => {
          const current = transactions.get(id)
          if (current?.value.status === 'PENDING')
            current.value = { id, status: 'FAILED', message: 'ChatGPT connection failed' }
        })
      return transaction
    },
    get(id) {
      return transactions.get(transactionId.parse(id))?.value
    },
    cancel(id) {
      const current = transactions.get(transactionId.parse(id))
      if (current?.value.status !== 'PENDING') return false
      current.controller.abort()
      current.value = { id, status: 'CANCELLED' }
      return true
    },
  }
}
