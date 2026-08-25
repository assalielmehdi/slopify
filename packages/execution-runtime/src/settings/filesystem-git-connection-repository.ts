import { GitConnectionSchema, GitProviderSchema, type GitProvider } from '@slopify/contracts'

import type {
  GitConnectionRecord,
  GitConnectionRepository,
} from '../git/git-connection-repository.js'
import {
  SettingsCredentialReferenceSchema,
  SettingsGitConnectionRecordSchema,
  type SettingsGitConnectionRecord,
  type SettingsStore,
} from './settings-store.js'

const credentialReference = (provider: GitProvider) =>
  SettingsCredentialReferenceSchema.parse(
    `credential://dev.slopify.git/${provider === 'GITHUB' ? 'github.com' : 'gitlab.com'}`,
  )

const publicRecord = (record: SettingsGitConnectionRecord): GitConnectionRecord =>
  GitConnectionSchema.parse({
    provider: record.provider,
    accountUsername: record.accountUsername,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
  })

export const createFilesystemGitConnectionRepository = (
  options: Readonly<{ settings: SettingsStore }>,
): GitConnectionRepository => ({
  async get(providerInput) {
    const provider = GitProviderSchema.parse(providerInput)
    const snapshot = await options.settings.read()
    const record = snapshot.value.git.connections.find(
      (connection) => connection.provider === provider,
    )
    return record === undefined ? undefined : publicRecord(record)
  },

  async list() {
    const snapshot = await options.settings.read()
    return snapshot.value.git.connections.map(publicRecord)
  },

  async save(input) {
    const connection = GitConnectionSchema.parse(input)
    const snapshot = await options.settings.read()
    const previous = snapshot.value.git.connections.find(
      (candidate) => candidate.provider === connection.provider,
    )
    const record = SettingsGitConnectionRecordSchema.parse({
      ...connection,
      connectedAt: previous?.connectedAt ?? connection.connectedAt,
      credentialReference: credentialReference(connection.provider),
    })
    const connections = [
      ...snapshot.value.git.connections.filter(
        (candidate) => candidate.provider !== connection.provider,
      ),
      record,
    ].sort((left, right) => left.provider.localeCompare(right.provider))

    await options.settings.write({
      value: {
        ...snapshot.value,
        git: { connections },
      },
      expectedRevision: snapshot.revision,
    })
  },

  async delete(providerInput) {
    const provider = GitProviderSchema.parse(providerInput)
    const snapshot = await options.settings.read()
    const connections = snapshot.value.git.connections.filter(
      (connection) => connection.provider !== provider,
    )
    if (connections.length === snapshot.value.git.connections.length) return false

    await options.settings.write({
      value: {
        ...snapshot.value,
        git: { connections },
      },
      expectedRevision: snapshot.revision,
    })
    return true
  },
})
