import { FEED_TIMEOUT_MS } from '@shared/constants'

export interface RawChapter {
  startSecs: number
  title: string
}

/**
 * Fetches and normalises a Podcast 2.0 chapters document.
 *
 * The spec uses `{ chapters: [{ startTime, title }] }`, but real-world
 * documents vary, so a bare array and `start`/`name` aliases are accepted too.
 */
export async function fetchChapters(url: string): Promise<RawChapter[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'j-Tunes/0.1 (+https://github.com/j-tunes)',
        Accept: 'application/json, */*;q=0.8'
      }
    })
    if (!response.ok) {
      throw new Error(`Chapters request failed with status ${response.status}`)
    }

    const json: unknown = await response.json()
    const list = Array.isArray(json) ? json : (json as { chapters?: unknown } | null)?.chapters
    if (!Array.isArray(list)) return []

    const out: RawChapter[] = []
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      const obj = raw as Record<string, unknown>
      const start = obj.startTime ?? obj.start ?? obj.time
      const title = obj.title ?? obj.name
      const startSecs = typeof start === 'number' ? start : Number(start)
      if (!Number.isFinite(startSecs) || startSecs < 0) continue
      const label =
        typeof title === 'string' && title.trim()
          ? title.trim()
          : `Chapter at ${Math.floor(startSecs)}s`
      out.push({ startSecs, title: label })
    }

    return out.sort((a, b) => a.startSecs - b.startSecs)
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Chapters request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}