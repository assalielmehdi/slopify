import { accessSync, constants, statSync } from 'node:fs'
import {
  ConnectorStatusSchema,
  ProjectProfileIdSchema,
  ProjectProfileReadinessSchema,
  type ConnectorStatus,
  type ProjectProfileReadiness,
} from '@loop/contracts'

import type { ProcessRunResult, ProcessRunner } from '../processes/process-runner.js'
import type { ProjectProfileService } from './project-profile-service.js'
import { ProjectProfileServiceError } from './project-profile-service.js'

export interface ReadinessFilesystem {
  isDirectory(path: string): boolean
  isReadable(path: string): boolean
  isWritable(path: string): boolean
}

export interface ReadinessService {
  connectorStatus(): ConnectorStatus
  check(profileId: string): Promise<ProjectProfileReadiness>
}

export interface CreateReadinessServiceOptions {
  readonly profiles: ProjectProfileService
  readonly processRunner: ProcessRunner
  readonly connectors: () => ConnectorStatus
  readonly filesystem?: ReadinessFilesystem
  readonly commandTimeoutMs?: number
}

const filesystem: ReadinessFilesystem = {
  isDirectory(path) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  isReadable(path) {
    try {
      accessSync(path, constants.R_OK)
      return true
    } catch {
      return false
    }
  },
  isWritable(path) {
    try {
      accessSync(path, constants.W_OK)
      return true
    } catch {
      return false
    }
  },
}

type Finding = ProjectProfileReadiness['repositories'][number]['findings'][number]

const finding = (category: Finding['category'], code: string, message: string): Finding => ({
  category,
  code,
  message,
})

const successful = (
  result: ProcessRunResult,
): result is Extract<ProcessRunResult, { readonly status: 'exited' }> =>
  result.status === 'exited' && result.exitCode === 0

const remoteProject = (remoteUrl: string): string => {
  const value = remoteUrl.trim().replace(/\.git$/, '')
  const sshSeparator = value.indexOf(':')
  if (value.startsWith('git@') && sshSeparator >= 0) return value.slice(sshSeparator + 1)
  try {
    return new URL(value).pathname.replace(/^\//, '')
  } catch {
    return value
  }
}

const connectorFindings = (status: ConnectorStatus): Finding[] => [
  ...(status.clickup
    ? []
    : [finding('clickup', 'CLICKUP_UNAVAILABLE', 'ClickUp credentials are unavailable')]),
  ...(status.gitlab
    ? []
    : [finding('gitlab', 'GITLAB_UNAVAILABLE', 'GitLab credentials are unavailable')]),
  ...(status.modelProvider
    ? []
    : [
        finding(
          'model-provider',
          'MODEL_PROVIDER_UNAVAILABLE',
          'Model-provider credentials are unavailable',
        ),
      ]),
]

export const createReadinessService = (
  options: CreateReadinessServiceOptions,
): ReadinessService => {
  const fs = options.filesystem ?? filesystem
  const timeoutMs = options.commandTimeoutMs ?? 5_000

  const run = (executable: string, arguments_: readonly string[], cwd: string) =>
    options.processRunner.run({ executable, arguments: arguments_, cwd, timeoutMs })

  return {
    connectorStatus() {
      return ConnectorStatusSchema.parse(options.connectors())
    },
    async check(profileIdInput) {
      const profileId = ProjectProfileIdSchema.parse(profileIdInput)
      const profile = options.profiles.get(profileId)
      if (profile === undefined) {
        throw new ProjectProfileServiceError('PROFILE_NOT_FOUND', 'Project profile was not found')
      }
      const connectors = ConnectorStatusSchema.parse(options.connectors())
      const repositories = []

      for (const repository of profile.repositories) {
        const findings: Finding[] = []
        const repositoryExists = fs.isDirectory(repository.repositoryPath)
        const worktreeParentExists = fs.isDirectory(repository.worktreeParent)
        if (!repositoryExists) {
          findings.push(
            finding('filesystem', 'REPOSITORY_PATH_MISSING', 'Repository path is unavailable'),
          )
        } else if (!fs.isReadable(repository.repositoryPath)) {
          findings.push(
            finding('filesystem', 'REPOSITORY_PATH_UNREADABLE', 'Repository path is unreadable'),
          )
        }
        if (!worktreeParentExists) {
          findings.push(
            finding('filesystem', 'WORKTREE_PARENT_MISSING', 'Worktree parent is unavailable'),
          )
        } else if (!fs.isWritable(repository.worktreeParent)) {
          findings.push(
            finding('filesystem', 'WORKTREE_PARENT_UNWRITABLE', 'Worktree parent is not writable'),
          )
        }

        if (repositoryExists && fs.isReadable(repository.repositoryPath)) {
          const remote = await run(
            'git',
            ['-C', repository.repositoryPath, 'remote', 'get-url', repository.remote],
            repository.repositoryPath,
          )
          if (!successful(remote)) {
            findings.push(finding('git', 'GIT_REMOTE_UNAVAILABLE', 'Git remote is unavailable'))
          } else if (remoteProject(remote.stdout) !== repository.gitlabProject) {
            findings.push(
              finding(
                'git',
                'GIT_REMOTE_MISMATCH',
                'Git remote does not match the configured project',
              ),
            )
          }

          const target = await run(
            'git',
            [
              '-C',
              repository.repositoryPath,
              'show-ref',
              '--quiet',
              '--verify',
              `refs/remotes/${repository.remote}/${repository.targetBranch}`,
            ],
            repository.repositoryPath,
          )
          if (!successful(target)) {
            findings.push(
              finding('git', 'GIT_TARGET_MISSING', 'Configured target branch is unavailable'),
            )
          }

          for (const check of repository.executableChecks) {
            const result = await run(check.executable, check.arguments, repository.repositoryPath)
            if (!successful(result)) {
              findings.push(finding('tool', 'TOOL_UNAVAILABLE', 'Required executable check failed'))
            } else if (
              check.expectedOutputIncludes !== undefined &&
              !`${result.stdout}\n${result.stderr}`.includes(check.expectedOutputIncludes)
            ) {
              findings.push(
                finding(
                  'tool',
                  'TOOL_VERSION_MISMATCH',
                  'Required executable version is incompatible',
                ),
              )
            }
          }
        }
        findings.push(...connectorFindings(connectors))
        repositories.push({
          repositoryId: repository.repositoryId,
          ready: findings.length === 0,
          findings,
        })
      }

      return ProjectProfileReadinessSchema.parse({
        profileId,
        ready: connectors.modelProvider && repositories.every(({ ready }) => ready),
        repositories,
      })
    },
  }
}
