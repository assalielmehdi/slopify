import process from 'node:process'

const [argument, secret, countInput = '0'] = process.argv.slice(2)
const count = Number.parseInt(countInput, 10)

process.stdout.write(`stdout:${argument}:${secret}:${'o'.repeat(count)}`)
process.stderr.write(`stderr:${secret}:${'e'.repeat(count)}`)
