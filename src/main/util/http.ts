/**
 * Shared HTTP client for feeds, chapter documents, and enclosure downloads.
 * Only http and https are fetched, including every redirect hop, and callers
 * can refuse a body larger than a fixed limit.
 */

export class HttpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

const MAX_REDIRECTS = 5

/** Accepts an absolute http(s) URL and rejects every other scheme. */
export function assertHttpUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new HttpError(`Invalid URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(`Unsupported protocol: ${url.protocol}`)
  }
  return url
}

/**
 * Fetches a URL, following redirects only when the next hop is http or https.
 * A `file:`, `ftp:`, or other redirect target throws instead of being fetched.
 */
export async function fetchHttp(input: string, init: RequestInit = {}): Promise<Response> {
  let current = assertHttpUrl(input).toString()

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined)
      if (hop === MAX_REDIRECTS) throw new HttpError('Too many redirects')
      current = assertHttpUrl(new URL(location, current).toString()).toString()
      continue
    }
    return response
  }

  throw new HttpError('Too many redirects')
}

/** Reads a response body as text, aborting once it grows past `maxBytes`. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new HttpError(`Response exceeded ${maxBytes} bytes`)
  }

  if (!response.body) throw new HttpError('Response had no body')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new HttpError(`Response exceeded ${maxBytes} bytes`)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}
