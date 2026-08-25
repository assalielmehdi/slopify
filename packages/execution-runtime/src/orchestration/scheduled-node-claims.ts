export interface ScheduledNodeClaim {
  release(): void
}

export interface ScheduledNodeClaims {
  tryClaim(key: string): ScheduledNodeClaim | undefined
}

const validConcurrency = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new TypeError('Worker concurrency is invalid')
  }
  return value
}

export const createScheduledNodeClaims = (concurrency = 2): ScheduledNodeClaims => {
  const limit = validConcurrency(concurrency)
  const active = new Set<string>()
  return {
    tryClaim(key) {
      if (active.size >= limit || active.has(key)) return undefined
      active.add(key)
      let released = false
      return {
        release() {
          if (released) return
          released = true
          active.delete(key)
        },
      }
    },
  }
}
