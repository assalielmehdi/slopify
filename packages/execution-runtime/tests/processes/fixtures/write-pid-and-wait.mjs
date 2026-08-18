import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { setInterval } from 'node:timers'

const [pidFile] = process.argv.slice(2)
writeFileSync(pidFile, String(process.pid))
process.on('SIGTERM', () => {})
setInterval(() => {}, 1_000)
