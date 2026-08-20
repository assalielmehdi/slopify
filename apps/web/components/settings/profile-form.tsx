'use client'

import {
  ProjectProfileConfigurationSchema,
  type ProjectProfileConfiguration,
  type ProjectProfileRuntimeBoundary,
} from '@loop/contracts'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import type { z } from 'zod'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export type ProjectProfileDraft = z.input<typeof ProjectProfileConfigurationSchema>
type ProfileDraft = ProjectProfileDraft
type RepositoryDraft = ProfileDraft['repositories'][number]
type FieldErrors = Readonly<Record<string, string>>

const splitLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const splitLabels = (value: string) =>
  value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

const normalizedAbsolutePath = (path: string): string | undefined => {
  if (!path.startsWith('/')) return undefined
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/${segments.join('/')}`
}

const isInside = (root: string, path: string) =>
  root === '/' || path === root || path.startsWith(`${root}/`)

const emptyRepository = (repositoryId: string): RepositoryDraft => ({
  repositoryId,
  displayName: '',
  purpose: '',
  repositoryPath: '',
  gitlabProject: '',
  remote: 'origin',
  targetBranch: 'main',
  worktreeParent: '',
  branchTemplate: 'ai/{task}-{run}',
  executableChecks: [],
  verificationCommands: [],
  mergeRequestLabels: [],
})

export const createEmptyProjectProfile = (): ProfileDraft => ({
  profileId: 'new-profile',
  displayName: '',
  clickupWorkspaceId: '',
  clickupListId: '',
  clickupInReviewStatusId: '',
  repositories: [emptyRepository('repository-1')],
})

interface TextControlProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly error?: string | undefined
  readonly disabled?: boolean
  readonly multiline?: boolean
  readonly required?: boolean
  readonly onChange: (value: string) => void
}

function TextControl({
  id,
  label,
  value,
  error,
  disabled,
  multiline = false,
  required = true,
  onChange,
}: TextControlProps) {
  const controlProps = {
    'aria-describedby': error === undefined ? undefined : `${id}-error`,
    'aria-invalid': error === undefined ? undefined : true,
    disabled,
    id,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.currentTarget.value),
    required,
    value,
  }

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? <Textarea {...controlProps} /> : <Input {...controlProps} />}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  )
}

interface ProfileFormProps {
  readonly mode: 'create' | 'edit'
  readonly profile: ProfileDraft
  readonly runtime: ProjectProfileRuntimeBoundary
  readonly onSave: (profile: ProjectProfileConfiguration) => Promise<void>
}

export function ProfileForm({ mode, profile, runtime, onSave }: ProfileFormProps) {
  const formId = useId()
  const [draft, setDraft] = useState<ProfileDraft>(profile)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setDraft(profile)
    setErrors({})
    setFormError(undefined)
  }, [profile])

  const clearValidation = () => {
    setErrors({})
    setFormError(undefined)
  }

  const updateProfile = (changes: Partial<ProfileDraft>) => {
    clearValidation()
    setDraft((current) => ({ ...current, ...changes }))
  }

  const updateRepository = (index: number, update: (repo: RepositoryDraft) => RepositoryDraft) => {
    clearValidation()
    setDraft((current) => ({
      ...current,
      repositories: current.repositories.map((repository, repositoryIndex) =>
        repositoryIndex === index ? update(repository) : repository,
      ),
    }))
  }

  const moveRepository = (index: number, offset: -1 | 1) => {
    clearValidation()
    setDraft((current) => {
      const repositories = [...current.repositories]
      const destination = index + offset
      if (destination < 0 || destination >= repositories.length) return current
      const [repository] = repositories.splice(index, 1)
      if (repository === undefined) return current
      repositories.splice(destination, 0, repository)
      return { ...current, repositories }
    })
  }

  const addRepository = () => {
    clearValidation()
    setDraft((current) => {
      const existing = new Set(current.repositories.map(({ repositoryId }) => repositoryId))
      let suffix = current.repositories.length + 1
      while (existing.has(`repository-${suffix}`)) suffix += 1
      return {
        ...current,
        repositories: [...current.repositories, emptyRepository(`repository-${suffix}`)],
      }
    })
  }

  const removeRepository = (index: number) => {
    clearValidation()
    setDraft((current) => ({
      ...current,
      repositories: current.repositories.filter((_, candidateIndex) => candidateIndex !== index),
    }))
  }

  const validatePaths = (
    candidate: ProjectProfileConfiguration,
    nextErrors: Record<string, string>,
  ) => {
    const normalizedRoot = normalizedAbsolutePath(runtime.root) ?? runtime.root
    const seenPaths = new Set<string>()
    const seenIds = new Set<string>()

    candidate.repositories.forEach((repository, index) => {
      const idKey = `repositories.${index}.repositoryId`
      if (seenIds.has(repository.repositoryId)) nextErrors[idKey] = 'Repository IDs must be unique.'
      seenIds.add(repository.repositoryId)

      for (const field of ['repositoryPath', 'worktreeParent'] as const) {
        const key = `repositories.${index}.${field}`
        const normalizedPath = normalizedAbsolutePath(repository[field])
        if (normalizedPath === undefined) {
          nextErrors[key] = 'Path must be absolute.'
          continue
        }
        if (runtime.mode === 'container' && !isInside(normalizedRoot, normalizedPath)) {
          nextErrors[key] = `Path must be inside ${runtime.root}.`
        }
        if (field === 'repositoryPath') {
          if (seenPaths.has(normalizedPath)) nextErrors[key] = 'Repository paths must be unique.'
          seenPaths.add(normalizedPath)
        }
      }
    })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})
    setFormError(undefined)

    const parsed = ProjectProfileConfigurationSchema.safeParse(draft)
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        if (nextErrors[key] === undefined) nextErrors[key] = issue.message
      }
      setErrors(nextErrors)
      if (Object.keys(nextErrors).length === 0) setFormError('Project profile is invalid.')
      return
    }

    const nextErrors: Record<string, string> = {}
    validatePaths(parsed.data, nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setPending(true)
    try {
      await onSave(parsed.data)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Project profile could not be saved.')
    } finally {
      setPending(false)
    }
  }

  const errorFor = (path: string) => errors[path]

  return (
    <form aria-label="Project profile" onSubmit={(event) => void submit(event)}>
      <FieldSet disabled={pending} className="gap-5">
        <Alert>
          <AlertTitle>
            {runtime.mode === 'container' ? 'Compose runtime' : 'Native runtime'}
          </AlertTitle>
          <AlertDescription>
            Active runtime root: <code>{runtime.root}</code>.{' '}
            {runtime.mode === 'container'
              ? 'Host paths are invisible unless mounted into this root.'
              : 'Use absolute paths visible to the local API process.'}
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Profile and ClickUp defaults</CardTitle>
            <CardDescription>
              Shared identifiers are stored with the profile. Credential values are configured
              outside the UI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-3 md:grid-cols-2">
              <TextControl
                disabled={mode === 'edit'}
                error={errorFor('profileId')}
                id={`${formId}-profileId`}
                label="Profile ID"
                onChange={(profileId) => updateProfile({ profileId })}
                value={draft.profileId}
              />
              <TextControl
                error={errorFor('displayName')}
                id={`${formId}-displayName`}
                label="Profile name"
                onChange={(displayName) => updateProfile({ displayName })}
                value={draft.displayName}
              />
              <TextControl
                error={errorFor('clickupWorkspaceId')}
                id={`${formId}-clickupWorkspaceId`}
                label="ClickUp workspace ID"
                onChange={(clickupWorkspaceId) => updateProfile({ clickupWorkspaceId })}
                value={draft.clickupWorkspaceId}
              />
              <TextControl
                error={errorFor('clickupListId')}
                id={`${formId}-clickupListId`}
                label="ClickUp list ID"
                onChange={(clickupListId) => updateProfile({ clickupListId })}
                value={draft.clickupListId}
              />
              <TextControl
                error={errorFor('clickupInReviewStatusId')}
                id={`${formId}-clickupInReviewStatusId`}
                label="ClickUp in-review status ID"
                onChange={(clickupInReviewStatusId) => updateProfile({ clickupInReviewStatusId })}
                value={draft.clickupInReviewStatusId}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <section aria-labelledby={`${formId}-candidates`} className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id={`${formId}-candidates`} className="font-heading text-base font-semibold">
                Ordered candidate repositories
              </h2>
              <p className="text-xs/relaxed text-muted-foreground">
                This order is canonical for selection, execution evidence, and delivery.
              </p>
            </div>
            <Button
              disabled={draft.repositories.length >= 32}
              onClick={addRepository}
              type="button"
              variant="outline"
            >
              <PlusIcon aria-hidden="true" /> Add candidate
            </Button>
          </div>

          {draft.repositories.map((repository, index) => {
            const prefix = `repositories.${index}`
            const label =
              repository.displayName || repository.repositoryId || `Candidate ${index + 1}`
            const update = (changes: Partial<RepositoryDraft>) =>
              updateRepository(index, (current) => ({ ...current, ...changes }))

            return (
              <Card
                aria-label={`Candidate ${index + 1}: ${label}`}
                key={`${repository.repositoryId}-${index}`}
                role="group"
              >
                <CardHeader>
                  <CardTitle>
                    {index + 1}. {label}
                  </CardTitle>
                  <CardDescription>
                    {repository.purpose || 'Describe this candidate repository.'}
                  </CardDescription>
                  <CardAction className="flex gap-1">
                    <Button
                      aria-label={`Move ${label} up`}
                      disabled={index === 0}
                      onClick={() => moveRepository(index, -1)}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <ArrowUpIcon aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Move ${label} down`}
                      disabled={index === draft.repositories.length - 1}
                      onClick={() => moveRepository(index, 1)}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={`Remove ${label}`}
                      disabled={draft.repositories.length === 1}
                      onClick={() => removeRepository(index)}
                      size="icon-sm"
                      type="button"
                      variant="destructive"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <FieldGroup className="grid gap-3 md:grid-cols-2">
                    <TextControl
                      error={errorFor(`${prefix}.repositoryId`)}
                      id={`${formId}-${index}-repositoryId`}
                      label={`${label} repository ID`}
                      onChange={(repositoryId) => update({ repositoryId })}
                      value={repository.repositoryId}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.displayName`)}
                      id={`${formId}-${index}-displayName`}
                      label={`${label} display name`}
                      onChange={(displayName) => update({ displayName })}
                      value={repository.displayName}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.purpose`)}
                      id={`${formId}-${index}-purpose`}
                      label={`${label} purpose`}
                      multiline
                      onChange={(purpose) => update({ purpose })}
                      value={repository.purpose}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.repositoryPath`)}
                      id={`${formId}-${index}-repositoryPath`}
                      label={`${label} repository path`}
                      onChange={(repositoryPath) => update({ repositoryPath })}
                      value={repository.repositoryPath}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.gitlabProject`)}
                      id={`${formId}-${index}-gitlabProject`}
                      label={`${label} GitLab project`}
                      onChange={(gitlabProject) => update({ gitlabProject })}
                      value={repository.gitlabProject}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.remote`)}
                      id={`${formId}-${index}-remote`}
                      label={`${label} Git remote`}
                      onChange={(remote) => update({ remote })}
                      value={repository.remote}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.targetBranch`)}
                      id={`${formId}-${index}-targetBranch`}
                      label={`${label} target branch`}
                      onChange={(targetBranch) => update({ targetBranch })}
                      value={repository.targetBranch}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.worktreeParent`)}
                      id={`${formId}-${index}-worktreeParent`}
                      label={`${label} worktree parent`}
                      onChange={(worktreeParent) => update({ worktreeParent })}
                      value={repository.worktreeParent}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.branchTemplate`)}
                      id={`${formId}-${index}-branchTemplate`}
                      label={`${label} branch template`}
                      onChange={(branchTemplate) => update({ branchTemplate })}
                      value={repository.branchTemplate}
                    />
                    <TextControl
                      error={errorFor(`${prefix}.mergeRequestLabels`)}
                      id={`${formId}-${index}-mergeRequestLabels`}
                      label={`${label} merge request labels`}
                      onChange={(value) => update({ mergeRequestLabels: splitLabels(value) })}
                      required={false}
                      value={repository.mergeRequestLabels.join(', ')}
                    />
                  </FieldGroup>

                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium">Required tool checks</h3>
                      <Button
                        disabled={repository.executableChecks.length >= 16}
                        onClick={() =>
                          update({
                            executableChecks: [
                              ...repository.executableChecks,
                              { executable: '', arguments: [] },
                            ],
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Add required tool check
                      </Button>
                    </div>
                    {repository.executableChecks.map((check, checkIndex) => (
                      <div className="grid gap-3 border-l-2 pl-3 md:grid-cols-3" key={checkIndex}>
                        <TextControl
                          error={errorFor(`${prefix}.executableChecks.${checkIndex}.executable`)}
                          id={`${formId}-${index}-tool-${checkIndex}-executable`}
                          label={`Tool ${checkIndex + 1} executable`}
                          onChange={(executable) =>
                            update({
                              executableChecks: repository.executableChecks.map(
                                (item, itemIndex) =>
                                  itemIndex === checkIndex ? { ...item, executable } : item,
                              ),
                            })
                          }
                          value={check.executable}
                        />
                        <TextControl
                          error={errorFor(`${prefix}.executableChecks.${checkIndex}.arguments`)}
                          id={`${formId}-${index}-tool-${checkIndex}-arguments`}
                          label={`Tool ${checkIndex + 1} arguments`}
                          multiline
                          onChange={(value) =>
                            update({
                              executableChecks: repository.executableChecks.map(
                                (item, itemIndex) =>
                                  itemIndex === checkIndex
                                    ? { ...item, arguments: splitLines(value) }
                                    : item,
                              ),
                            })
                          }
                          required={false}
                          value={check.arguments.join('\n')}
                        />
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <TextControl
                              error={errorFor(
                                `${prefix}.executableChecks.${checkIndex}.expectedOutputIncludes`,
                              )}
                              id={`${formId}-${index}-tool-${checkIndex}-expected`}
                              label={`Tool ${checkIndex + 1} expected output`}
                              onChange={(expectedOutputIncludes) =>
                                update({
                                  executableChecks: repository.executableChecks.map(
                                    (item, itemIndex) => {
                                      if (itemIndex !== checkIndex) return item
                                      return expectedOutputIncludes === ''
                                        ? { executable: item.executable, arguments: item.arguments }
                                        : { ...item, expectedOutputIncludes }
                                    },
                                  ),
                                })
                              }
                              required={false}
                              value={check.expectedOutputIncludes ?? ''}
                            />
                          </div>
                          <Button
                            aria-label={`Remove tool ${checkIndex + 1}`}
                            onClick={() =>
                              update({
                                executableChecks: repository.executableChecks.filter(
                                  (_, itemIndex) => itemIndex !== checkIndex,
                                ),
                              })
                            }
                            size="icon-sm"
                            type="button"
                            variant="destructive"
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium">Verification commands</h3>
                      <Button
                        disabled={repository.verificationCommands.length >= 32}
                        onClick={() =>
                          update({
                            verificationCommands: [
                              ...repository.verificationCommands,
                              { executable: '', arguments: [] },
                            ],
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Add verification command
                      </Button>
                    </div>
                    {repository.verificationCommands.map((command, commandIndex) => (
                      <div
                        className="grid gap-3 border-l-2 pl-3 md:grid-cols-[1fr_1fr_auto]"
                        key={commandIndex}
                      >
                        <TextControl
                          error={errorFor(
                            `${prefix}.verificationCommands.${commandIndex}.executable`,
                          )}
                          id={`${formId}-${index}-command-${commandIndex}-executable`}
                          label={`Command ${commandIndex + 1} executable`}
                          onChange={(executable) =>
                            update({
                              verificationCommands: repository.verificationCommands.map(
                                (item, itemIndex) =>
                                  itemIndex === commandIndex ? { ...item, executable } : item,
                              ),
                            })
                          }
                          value={command.executable}
                        />
                        <TextControl
                          error={errorFor(
                            `${prefix}.verificationCommands.${commandIndex}.arguments`,
                          )}
                          id={`${formId}-${index}-command-${commandIndex}-arguments`}
                          label={`Command ${commandIndex + 1} arguments`}
                          multiline
                          onChange={(value) =>
                            update({
                              verificationCommands: repository.verificationCommands.map(
                                (item, itemIndex) =>
                                  itemIndex === commandIndex
                                    ? { ...item, arguments: splitLines(value) }
                                    : item,
                              ),
                            })
                          }
                          required={false}
                          value={command.arguments.join('\n')}
                        />
                        <Button
                          aria-label={`Remove command ${commandIndex + 1}`}
                          className="self-end"
                          onClick={() =>
                            update({
                              verificationCommands: repository.verificationCommands.filter(
                                (_, itemIndex) => itemIndex !== commandIndex,
                              ),
                            })
                          }
                          size="icon-sm"
                          type="button"
                          variant="destructive"
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        {formError === undefined ? null : <FieldError>{formError}</FieldError>}
        <div aria-live="polite" className="flex items-center gap-3">
          <Button disabled={pending} type="submit">
            {pending ? 'Saving profile…' : mode === 'create' ? 'Create profile' : 'Save profile'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Existing run snapshots remain immutable when profile settings change.
          </p>
        </div>
      </FieldSet>
    </form>
  )
}
