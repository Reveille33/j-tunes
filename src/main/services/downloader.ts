import { createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { DOWNLOAD_TIMEOUT_MS } from '@shared/constants'
import { fetchHttp } from '../util/http'

export interface DownloadOptions {
  url: string
  /** Final destination path (without extension handling). */
  destination: string
  /** Bytes already on disk from a previous partial download. */
  resumeFrom?: number
  signal?: AbortSignal
  onProgress?: (bytesDone: number, totalBytes: number | null) => void
  timeoutMs?: number
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface DownloadResult {
  path: string
  bytes: number
  totalBytes: number | null
}

/**
 * Downloads a file to disk, streaming it to a `.part` file and renaming it
 * to the final name only once the transfer has completed. A `.part` file is
 * therefore never mistaken for a finished download.
 *
 * When `resumeFrom` is greater than zero the request sends a `Range` header;
 * if the server ignores it and replies 200, the partial file is discarded
 * and the download restarts from the beginning.
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  const { url, destination } = options
  const partPath = `${destination}.part`
  const resumeFrom = options.resumeFrom ?? 0

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS)

  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'j-Tunes/0.1 (+https://github.com/j-tunes)',
      Accept: '*/*'
    }
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`

    const response = await fetchHttp(url, { headers, signal: controller.signal })

    if (!response.ok && response.status !== 206) {
      throw new DownloadError(
        `Download failed with status ${response.status}`,
        response.status
      )
    }

    // The server ignored our Range request: start over.
    const serverResumed = response.status === 206
    let bytesAlreadyOnDisk = serverResumed ? resumeFrom : 0
    if (!serverResumed && resumeFrom > 0) {
      await unlink(partPath).catch(() => undefined)
    }

    const contentLength = response.headers.get('content-length')
    const totalBytes = contentLength ? Number(contentLength) + bytesAlreadyOnDisk : null

    if (!response.body) {
      throw new DownloadError('Download response had no body')
    }

    let bytesDone = bytesAlreadyOnDisk
    let lastReport = 0

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

    source.on('data', (chunk: Buffer) => {
      bytesDone += chunk.length
      const now = Date.now()
      // Throttle progress reporting to avoid flooding the IPC channel.
      if (options.onProgress && now - lastReport > 250) {
        lastReport = now
        options.onProgress(bytesDone, totalBytes)
      }
    })

    await pipeline(source, createWriteStream(partPath, { flags: bytesAlreadyOnDisk > 0 ? 'a' : 'w' }), {
      signal: controller.signal
    })

    const info = await stat(partPath)

    // Move the finished file into place.
    const { moveFile } = await import('../util/fsHelpers')
    await moveFile(partPath, destination)

    options.onProgress?.(info.size, totalBytes ?? info.size)

    return {
      path: destination,
      bytes: info.size,
      totalBytes: totalBytes ?? info.size
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new DownloadError('Download was cancelled or timed out')
    }
    if (error instanceof DownloadError) throw error
    throw new DownloadError((error as Error).message)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** Returns the size of an existing partial download, or 0. */
export async function partialSize(destination: string): Promise<number> {
  try {
    const info = await stat(`${destination}.part`)
    return info.size
  } catch {
    return 0
  }
}
