import { spawn } from 'node:child_process'
import process from 'node:process'
import { setInterval } from 'node:timers'
import { fileURLToPath, URL } from 'node:url'

const [pidFile] = process.argv.slice(2)
const childFixture = fileURLToPath(new URL('./write-pid-and-wait.mjs', import.meta.url))
const child = spawn(process.execPath, [childFixture, pidFile], { stdio: 'ignore' })

process.stdout.write(`child:${child.pid}\n`)
process.on('SIGTERM', () => {})
setInterval(() => {}, 1_000)
