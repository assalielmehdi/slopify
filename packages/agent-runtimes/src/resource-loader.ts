import { isAbsolute, relative } from 'node:path'

import { RepositoryIdSchema } from '@loop/contracts'
import { ResourceBundleIdSchema } from '@loop/workflow-model'
import { z } from 'zod'

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)
const content = z
  .string()
  .min(1)
  .max(1_000_000)
  .refine((value) => value.trim().length > 0)

const ResourceSkillSchema = z
  .strictObject({
    name: identifier,
    description: z.string().trim().min(1).max(2_048),
    content,
  })
  .readonly()

const PromptFragmentSchema = z
  .strictObject({
    name: identifier,
    content,
  })
  .readonly()

const ResourceBundleDefinitionSchema = z
  .strictObject({
    bundleId: ResourceBundleIdSchema,
    applicationVersion: z.string().trim().min(1).max(128),
    skills: z.array(ResourceSkillSchema).max(32).readonly(),
    promptFragments: z.array(PromptFragmentSchema).max(32).readonly(),
  })
  .readonly()

const WorkspaceRepositorySchema = z
  .strictObject({
    repositoryId: RepositoryIdSchema,
    path: z.string().min(1).max(4_096).refine(isAbsolute),
  })
  .readonly()

const ContextFileSchema = z
  .strictObject({
    repositoryId: RepositoryIdSchema,
    path: z.string().min(1).max(4_096).refine(isAbsolute),
    content,
  })
  .readonly()

const LoadResourceBundleInputSchema = z.strictObject({
  bundleId: ResourceBundleIdSchema,
  bundles: z.array(ResourceBundleDefinitionSchema).min(1).max(64).readonly(),
  workspaceRepositories: z.array(WorkspaceRepositorySchema).min(1).max(32).readonly(),
  contextFiles: z.array(ContextFileSchema).max(128).readonly(),
})

export type ResourceLoaderErrorCode =
  'RESOURCE_BUNDLE_NOT_FOUND' | 'RESOURCE_CONTEXT_OUTSIDE_WORKSPACE' | 'RESOURCE_INPUT_INVALID'

const messages: Readonly<Record<ResourceLoaderErrorCode, string>> = {
  RESOURCE_BUNDLE_NOT_FOUND: 'Resource bundle was not found',
  RESOURCE_CONTEXT_OUTSIDE_WORKSPACE: 'Resource context is outside the explicit workspace',
  RESOURCE_INPUT_INVALID: 'Resource loader input is invalid',
}

export class ResourceLoaderError extends Error {
  override readonly name = 'ResourceLoaderError'

  constructor(readonly code: ResourceLoaderErrorCode) {
    super(messages[code])
  }
}

export interface ResourceSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

export interface PromptFragment {
  readonly name: string
  readonly content: string
}

export interface ResourceBundleDefinition {
  readonly bundleId: string
  readonly applicationVersion: string
  readonly skills: readonly ResourceSkill[]
  readonly promptFragments: readonly PromptFragment[]
}

export interface WorkspaceResourceRepository {
  readonly repositoryId: string
  readonly path: string
}

export interface ResourceContextFile {
  readonly repositoryId: string
  readonly path: string
  readonly content: string
}

export interface LoadResourceBundleInput {
  readonly bundleId: string
  readonly bundles: readonly ResourceBundleDefinition[]
  readonly workspaceRepositories: readonly WorkspaceResourceRepository[]
  readonly contextFiles: readonly ResourceContextFile[]
}

export interface LoadedResourceBundle extends ResourceBundleDefinition {
  readonly contextFiles: readonly ResourceContextFile[]
}

const hasDuplicates = (values: readonly string[]): boolean => new Set(values).size !== values.length

const freezeBundle = (bundle: LoadedResourceBundle): LoadedResourceBundle =>
  Object.freeze({
    ...bundle,
    skills: Object.freeze(bundle.skills.map((skill) => Object.freeze({ ...skill }))),
    promptFragments: Object.freeze(
      bundle.promptFragments.map((fragment) => Object.freeze({ ...fragment })),
    ),
    contextFiles: Object.freeze(bundle.contextFiles.map((file) => Object.freeze({ ...file }))),
  })

export const loadResourceBundle = (input: LoadResourceBundleInput): LoadedResourceBundle => {
  const parsed = LoadResourceBundleInputSchema.safeParse(input)
  if (!parsed.success) throw new ResourceLoaderError('RESOURCE_INPUT_INVALID')

  if (
    hasDuplicates(parsed.data.bundles.map(({ bundleId }) => bundleId)) ||
    hasDuplicates(parsed.data.workspaceRepositories.map(({ repositoryId }) => repositoryId)) ||
    hasDuplicates(parsed.data.workspaceRepositories.map(({ path }) => path)) ||
    hasDuplicates(parsed.data.contextFiles.map(({ path }) => path))
  ) {
    throw new ResourceLoaderError('RESOURCE_INPUT_INVALID')
  }

  for (const bundle of parsed.data.bundles) {
    if (
      hasDuplicates(bundle.skills.map(({ name }) => name)) ||
      hasDuplicates(bundle.promptFragments.map(({ name }) => name))
    ) {
      throw new ResourceLoaderError('RESOURCE_INPUT_INVALID')
    }
  }

  const bundle = parsed.data.bundles.find(({ bundleId }) => bundleId === parsed.data.bundleId)
  if (bundle === undefined) throw new ResourceLoaderError('RESOURCE_BUNDLE_NOT_FOUND')

  const workspacePosition = new Map(
    parsed.data.workspaceRepositories.map((repository, index) => [repository.repositoryId, index]),
  )
  const workspaceById = new Map(
    parsed.data.workspaceRepositories.map((repository) => [repository.repositoryId, repository]),
  )

  for (const file of parsed.data.contextFiles) {
    const repository = workspaceById.get(file.repositoryId)
    if (repository === undefined) {
      throw new ResourceLoaderError('RESOURCE_CONTEXT_OUTSIDE_WORKSPACE')
    }
    const relativePath = relative(repository.path, file.path)
    if (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith('../') ||
      isAbsolute(relativePath)
    ) {
      throw new ResourceLoaderError('RESOURCE_CONTEXT_OUTSIDE_WORKSPACE')
    }
  }

  const contextFiles = [...parsed.data.contextFiles].sort((left, right) => {
    const position =
      (workspacePosition.get(left.repositoryId) ?? 0) -
      (workspacePosition.get(right.repositoryId) ?? 0)
    return position === 0 ? left.path.localeCompare(right.path) : position
  })

  return freezeBundle({
    bundleId: bundle.bundleId,
    applicationVersion: bundle.applicationVersion,
    skills: bundle.skills,
    promptFragments: bundle.promptFragments,
    contextFiles,
  })
}
