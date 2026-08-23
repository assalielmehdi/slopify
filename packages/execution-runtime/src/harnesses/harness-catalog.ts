import {
  HarnessDescriptorSchema,
  HarnessIdSchema,
  type HarnessDescriptor,
  type HarnessId,
  type HarnessThinkingLevel,
} from '@slopify/contracts'

export type HarnessCatalogErrorCode =
  | 'HARNESS_NOT_FOUND'
  | 'HARNESS_UNAVAILABLE'
  | 'HARNESS_MODEL_UNAVAILABLE'
  | 'HARNESS_THINKING_UNAVAILABLE'

export class HarnessCatalogError extends Error {
  override readonly name = 'HarnessCatalogError'

  constructor(
    readonly code: HarnessCatalogErrorCode,
    message: string,
    readonly descriptor?: HarnessDescriptor,
  ) {
    super(message)
  }
}

export interface HarnessInspector {
  readonly harnessId: HarnessId | string
  inspect(): Promise<HarnessDescriptor>
}

export type AvailableHarnessDescriptor = Extract<
  HarnessDescriptor,
  { readonly availability: 'AVAILABLE' }
>

export interface HarnessCatalog {
  list(): Promise<readonly HarnessDescriptor[]>
  get(harnessId: string): Promise<HarnessDescriptor | undefined>
  requireAvailable(
    harnessId: string,
    modelId?: string,
    thinkingLevel?: HarnessThinkingLevel,
  ): Promise<AvailableHarnessDescriptor>
}

export const createHarnessCatalog = (options: {
  readonly inspectors: readonly HarnessInspector[]
}): HarnessCatalog => {
  const inspectors = new Map<HarnessId, HarnessInspector>()
  for (const inspector of options.inspectors) {
    const harnessId = HarnessIdSchema.parse(inspector.harnessId)
    if (inspectors.has(harnessId)) throw new TypeError(`Duplicate harness inspector: ${harnessId}`)
    inspectors.set(harnessId, inspector)
  }

  const inspect = async (
    harnessId: HarnessId,
    inspector: HarnessInspector,
  ): Promise<HarnessDescriptor> => {
    const descriptor = HarnessDescriptorSchema.parse(await inspector.inspect())
    if (descriptor.harnessId !== harnessId)
      throw new TypeError(`Harness inspector returned an unexpected ID: ${descriptor.harnessId}`)
    return descriptor
  }

  const get = async (harnessIdInput: string): Promise<HarnessDescriptor | undefined> => {
    const harnessId = HarnessIdSchema.parse(harnessIdInput)
    const inspector = inspectors.get(harnessId)
    return inspector === undefined ? undefined : inspect(harnessId, inspector)
  }

  return {
    list: () =>
      Promise.all([...inspectors].map(([harnessId, inspector]) => inspect(harnessId, inspector))),
    get,
    async requireAvailable(harnessIdInput, modelId, thinkingLevel) {
      const descriptor = await get(harnessIdInput)
      if (descriptor === undefined)
        throw new HarnessCatalogError('HARNESS_NOT_FOUND', 'Harness was not found')
      if (descriptor.availability !== 'AVAILABLE')
        throw new HarnessCatalogError(
          'HARNESS_UNAVAILABLE',
          descriptor.unavailableReason,
          descriptor,
        )
      const model =
        modelId === undefined ? undefined : descriptor.models.find(({ id }) => id === modelId)
      if (modelId !== undefined && model === undefined)
        throw new HarnessCatalogError(
          'HARNESS_MODEL_UNAVAILABLE',
          'The selected model is not available through this harness',
          descriptor,
        )
      if (
        thinkingLevel !== undefined &&
        model !== undefined &&
        !model.thinkingLevels.includes(thinkingLevel)
      ) {
        throw new HarnessCatalogError(
          'HARNESS_THINKING_UNAVAILABLE',
          'The selected thinking effort is not available for this model',
          descriptor,
        )
      }
      return descriptor
    },
  }
}
