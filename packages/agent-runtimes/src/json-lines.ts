const MAX_JSONL_RECORD_BYTES = 4 * 1024 * 1024

export async function* decodeJsonLines(
  source: AsyncIterable<string | Uint8Array>,
): AsyncIterable<unknown> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of source) {
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let delimiterIndex = buffered.indexOf('\n')
    while (delimiterIndex >= 0) {
      let record = buffered.slice(0, delimiterIndex)
      buffered = buffered.slice(delimiterIndex + 1)
      if (record.endsWith('\r')) record = record.slice(0, -1)
      if (Buffer.byteLength(record, 'utf8') > MAX_JSONL_RECORD_BYTES) {
        throw new Error('JSONL record is too large')
      }
      if (record.length > 0) yield JSON.parse(record) as unknown
      delimiterIndex = buffered.indexOf('\n')
    }
    if (Buffer.byteLength(buffered, 'utf8') > MAX_JSONL_RECORD_BYTES) {
      throw new Error('JSONL record is too large')
    }
  }
  buffered += decoder.decode()
  if (buffered.length > 0) throw new Error('JSONL stream ended with an unterminated JSONL record')
}
