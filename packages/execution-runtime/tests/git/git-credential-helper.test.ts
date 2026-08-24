import { describe, expect, it, vi } from 'vitest'

import {
  createGitCredentialHelperCommand,
  handleGitCredentialRequest,
  parseGitCredentialInput,
} from '../../src/git/git-credential-helper.js'

describe('Git credential helper', () => {
  it('parses the bounded key-value credential protocol', () => {
    expect(
      parseGitCredentialInput('protocol=https\nhost=github.com\npath=owner/repo.git\n\n'),
    ).toEqual({
      protocol: 'https',
      host: 'github.com',
      path: 'owner/repo.git',
    })
  })

  it.each([
    ['github.com', 'GITHUB', 'x-access-token'],
    ['gitlab.com', 'GITLAB', 'oauth2'],
  ] as const)(
    'returns the stored token only for a supported HTTPS host',
    async (host, provider, username) => {
      const getToken = vi.fn(async () => 'secret-token')

      await expect(
        handleGitCredentialRequest('get', `protocol=https\nhost=${host}\n\n`, getToken),
      ).resolves.toBe(
        `protocol=https\nhost=${host}\nusername=${username}\npassword=secret-token\n\n`,
      )
      expect(getToken).toHaveBeenCalledWith(provider)
    },
  )

  it('ignores stores, erases, unsupported hosts, and non-HTTPS requests', async () => {
    const getToken = vi.fn(async () => 'secret-token')

    await expect(
      handleGitCredentialRequest('store', 'protocol=https\nhost=github.com\n\n', getToken),
    ).resolves.toBe('')
    await expect(
      handleGitCredentialRequest('get', 'protocol=http\nhost=github.com\n\n', getToken),
    ).resolves.toBe('')
    await expect(
      handleGitCredentialRequest('get', 'protocol=https\nhost=example.com\n\n', getToken),
    ).resolves.toBe('')
    expect(getToken).not.toHaveBeenCalled()
  })

  it('quotes executable and helper paths for Git shell execution', () => {
    expect(
      createGitCredentialHelperCommand("/Applications/Bun's/bin/bun", '/tmp/Slopify Helper.js'),
    ).toBe("!'/Applications/Bun'\\''s/bin/bun' '/tmp/Slopify Helper.js'")
  })
})
