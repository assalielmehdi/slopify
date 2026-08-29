import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { GitProvider } from '@slopify/shared'

import { createBunGitSecretStore } from './bun-git-secret-store.js'

const MAX_INPUT_BYTES = 64 * 1_024

export type GitCredentialAction = 'get' | 'store' | 'erase'
export type GitCredentialInput = Readonly<Record<string, string>>
export type GitCredentialTokenReader = (provider: GitProvider) => Promise<string | null>

export const parseGitCredentialInput = (input: string): GitCredentialInput => {
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES)
    throw new TypeError('Git credential input is too large')
  const result: Record<string, string> = {}
  for (const line of input.split('\n')) {
    if (line === '' || line === '\r') break
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1).replace(/\r$/u, '')
    result[key] = value
  }
  return result
}

const hostConfiguration = (
  host: string,
): Readonly<{ provider: GitProvider; username: string }> | undefined => {
  if (host === 'github.com') return { provider: 'GITHUB', username: 'x-access-token' }
  if (host === 'gitlab.com') return { provider: 'GITLAB', username: 'oauth2' }
  return undefined
}

export const handleGitCredentialRequest = async (
  action: GitCredentialAction,
  input: string,
  getToken: GitCredentialTokenReader,
): Promise<string> => {
  if (action !== 'get') return ''
  const credential = parseGitCredentialInput(input)
  if (credential.protocol !== 'https' || credential.host === undefined) return ''
  const configuration = hostConfiguration(credential.host)
  if (configuration === undefined) return ''
  const token = await getToken(configuration.provider)
  if (token === null || token === '') return ''
  return `protocol=https\nhost=${credential.host}\nusername=${configuration.username}\npassword=${token}\n\n`
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export const createGitCredentialHelperCommand = (
  executablePath: string,
  helperPath: string,
): string => `!${shellQuote(executablePath)} ${shellQuote(helperPath)}`

export const gitCredentialHelperPath = (): string => {
  const compiled = fileURLToPath(new URL('./git-credential-helper.js', import.meta.url))
  if (existsSync(compiled)) return compiled
  return fileURLToPath(new URL('./git-credential-helper.ts', import.meta.url))
}

const run = async (): Promise<void> => {
  const action = process.argv[2]
  if (action !== 'get' && action !== 'store' && action !== 'erase') return
  const input = readFileSync(0, 'utf8')
  const secrets = createBunGitSecretStore()
  const output = await handleGitCredentialRequest(action, input, (provider) =>
    secrets.get(provider),
  )
  if (output !== '') process.stdout.write(output)
}

if (import.meta.main) {
  await run()
}
