import { afterEach, describe, expect, it } from 'vitest'

import { TEST_RUN_ID, createPersistenceFixture, createRun } from './test-fixture.js'

const fixtures: ReturnType<typeof createPersistenceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup()
})

describe('run event store', () => {
  it('reads the append-only current run history with bounded pagination', () => {
    const fixture = createPersistenceFixture()
    fixtures.push(fixture)
    createRun(fixture)

    expect(fixture.events.list({ runId: TEST_RUN_ID, limit: 1 })).toEqual({
      events: [
        expect.objectContaining({
          runId: TEST_RUN_ID,
          sequence: 1,
          type: 'RUN_STARTED',
        }),
      ],
      nextAfterSequence: null,
    })
  })
})
