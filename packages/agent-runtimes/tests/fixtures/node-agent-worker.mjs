import process from 'node:process'

process.on('message', (message) => {
  if (message?.version !== 1 || message.type !== 'START') return
  if (process.release.name !== 'node') process.exit(2)
  const input = message.input
  process.send?.({
    version: 1,
    type: 'EVENT',
    event: {
      executionId: input.executionId,
      runId: input.runId,
      nodeId: input.nodeId,
      timestamp: '2026-08-22T12:00:00.000Z',
      type: 'AGENT_CANCELLED',
      data: { reason: 'Node worker verified', durationMs: 1 },
    },
  })
  process.send?.({ version: 1, type: 'COMPLETE' })
  process.disconnect()
})
