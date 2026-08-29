import { describe, expect, it } from 'vitest'

import { resolveNodeExecutionPaths, resolveSlopifyPaths } from '../../src/index.js'

describe('run artifact layout', () => {
  const runPaths = resolveSlopifyPaths({
    environment: { SLOPIFY_HOME: '/private/tmp/slopify-test' },
  }).run('review-change', 'run-01')

  it('places node artifacts in an ordered deterministic directory', () => {
    expect(resolveNodeExecutionPaths(runPaths, 12, 'node-execution-01')).toEqual({
      directory:
        '/private/tmp/slopify-test/workflows/review-change/runs/run-01/nodes/12-node-execution-01',
      executionFile:
        '/private/tmp/slopify-test/workflows/review-change/runs/run-01/nodes/12-node-execution-01/execution.json',
      traceFile:
        '/private/tmp/slopify-test/workflows/review-change/runs/run-01/nodes/12-node-execution-01/trace.jsonl',
    })
  })

  it.each([
    [-1, 'node-execution-01'],
    [1.5, 'node-execution-01'],
    [0, '../escape'],
    [0, 'nested/execution'],
    [0, 'UPPERCASE'],
  ])('rejects unsafe execution coordinates', (executionIndex, nodeExecutionId) => {
    expect(() => resolveNodeExecutionPaths(runPaths, executionIndex, nodeExecutionId)).toThrow(
      TypeError,
    )
  })
})
