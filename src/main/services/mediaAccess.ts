import { createReadStream, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { AUDIO_MIME_TYPES, SUPPORTED_AUDIO_EXTENSIONS } from '@shared/constants'

export interface LocalMediaRequest {
  filePath: string | null
  downloadDir: string
  /** Imported library files may live outside the download directory. */
  imported: boolean
}

export type LocalMediaDecision =
  | { ok: true; path: string }
  | { ok: false; status: 403 | 404 }

/**
 * `media://episode/<id>`. Anything else, including a URL that carries a raw
 * filesystem path, is not a playable request.
 */
export function parseMediaEpisodeId(rawUrl: string): number | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'media:' || url.hostname !== 'episode') return null

  const segment = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/')[0] ?? ''
  if (!/^[1-9]\d*$/.test(segment)) return null
  const id = Number(segment)
  if (!Number.isSafeInteger(id)) return null
  return id
}

/** Returns the URL unchanged when it is http or https, otherwise null. */
export function httpMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function mediaEpisodeUrl(episodeId: number): string {
  return `media://episode/${episodeId}`
}

/** True when `target` is a file strictly inside `root` after both are resolved. */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Decides whether a stored episode file may be streamed.
 *
 * The path comes from the episode row, never from the request URL. A normal
 * download must resolve to a real file inside the download directory, so a
 * symlink or `..` segment that escapes that directory is rejected. An
 * imported file may live at its stored path outside that directory.
 */
export async function authorizeLocalFile(input: LocalMediaRequest): Promise<LocalMediaDecision> {
  if (!input.filePath) return { ok: false, status: 404 }

  let resolved: string
  try {
    resolved = await realpath(input.filePath)
    const info = await stat(resolved)
    if (!info.isFile()) return { ok: false, status: 404 }
  } catch {
    return { ok: false, status: 404 }
  }

  const extension = extname(resolved).toLowerCase()
  if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, status: 403 }
  }

  if (input.imported) return { ok: true, path: resolved }

  let root: string
  try {
    root = await realpath(input.downloadDir)
  } catch {
    return { ok: false, status: 403 }
  }
  if (!isPathInside(root, resolved)) return { ok: false, status: 403 }
  return { ok: true, path: resolved }
}

/** Streams an already-authorized local file, including HTTP range requests. */
export function serveLocalFile(filePath: string, request: Request): Response {
  const stat = statSync(filePath)
  if (!stat.isFile()) return new Response('Not found', { status: 404 })

  const fileSize = stat.size
  const ext = extname(filePath).toLowerCase()
  const mimeType = AUDIO_MIME_TYPES[ext] || 'audio/mpeg'
  const range = request.headers.get('range')

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    if (match) {
      const start = parseInt(match[1], 10)
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
      if (start < fileSize && end < fileSize && start <= end) {
        const chunkSize = end - start + 1
        const fileStream = createReadStream(filePath, { start, end })
        const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream
        return new Response(webStream, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': mimeType
          }
        })
      }
    }
  }

  const fileStream = createReadStream(filePath)
  const webStream = Readable.toWeb(fileStream) as unknown as ReadableStream
  return new Response(webStream, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType
    }
  })
}
