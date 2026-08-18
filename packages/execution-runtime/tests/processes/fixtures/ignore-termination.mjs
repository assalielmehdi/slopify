import process from 'node:process'
import { setInterval } from 'node:timers'

process.on('SIGTERM', () => {})
setInterval(() => {}, 1_000)
