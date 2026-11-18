import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_FEED_BYTES } from '../src/shared/constants'
import { fetchHttp } from '../src/main/util/http'
import { fetchFeed, FeedError } from '../src/main/services/feedService'
import { fetchChapters } from '../src/main/services/chapterService'
import { downloadFile } from '../src/main/services/downloader'
import {
  authorizeLocalFile,
  httpMediaUrl,
  parseMediaEpisodeId
} from '../src/main/services/mediaAccess'

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Ok</title></channel></rss>`

let server: Server | null = null
let dirs: string[] = []

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.()
    server.close()
    server = null
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jtunes-sec-'))
  dirs.push(dir)
  return dir
}

async function listen(): Promise<string> {
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path.startsWith('/to-file')) {
      res.writeHead(302, { Location: 'file:///etc/passwd' })
      res.end()
      return
    }
    if (path.startsWith('/to-ftp')) {
      res.writeHead(302, { Location: 'ftp://example.com/feed.xml' })
      res.end()
      return
    }
    if (path.startsWith('/to-ok')) {
      res.writeHead(302, { Location: '/ok' })
      res.end()
      return
    }
    if (path.startsWith('/ok')) {
      res.writeHead(200, { 'Content-Type': 'application/rss+xml' })
      res.end(RSS)
      return
    }
    if (path.startsWith('/chapters')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ chapters: [{ startTime: 1, title: 'Intro' }] }))
      return
    }
    if (path.startsWith('/huge')) {
      res.writeHead(200, { 'Content-Type': 'application/xml' })
      const chunk = Buffer.alloc(64 * 1024, 0x61)
      let sent = 0
      const target = MAX_FEED_BYTES + chunk.length
      const write = (): void => {
        let ok = true
        while (sent < target && ok) {
          ok = res.write(chunk)
          sent += chunk.length
        }
        if (sent < target) res.once('drain', write)
        else res.end()
      }
      res.on('error', () => undefined)
      write()
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return `http://127.0.0.1:${port}`
}

describe('media protocol authorization', () => {
  it('rejects a raw filesystem path and accepts only an episode id', () => {
    expect(parseMediaEpisodeId('media://audio/?path=%2Fetc%2Fpasswd')).toBeNull()
    expect(parseMediaEpisodeId('media://episode/12')).toBe(12)
    expect(parseMediaEpisodeId('media://episode/0')).toBeNull()
  })

  it('rejects a stored path outside the download directory', async () => {
    const root = await tempDir()
    const downloadDir = join(root, 'downloads')
    const outside = join(root, 'secret.mp3')
    await mkdir(downloadDir)
    await writeFile(outside, 'nope')

    const decision = await authorizeLocalFile({
      filePath: outside,
      downloadDir,
      imported: false
    })
    expect(decision).toEqual({ ok: false, status: 403 })
  })

  it('rejects a symlink inside the download directory that points outside it', async () => {
    const root = await tempDir()
    const downloadDir = join(root, 'downloads')
    const outside = join(root, 'secret.mp3')
    const link = join(downloadDir, 'episode.mp3')
    await mkdir(downloadDir)
    await writeFile(outside, 'nope')
    await symlink(outside, link)

    const decision = await authorizeLocalFile({
      filePath: link,
      downloadDir,
      imported: false
    })
    expect(decision).toEqual({ ok: false, status: 403 })
  })

  it('serves a file inside the download directory and an imported file outside it', async () => {
    const root = await tempDir()
    const downloadDir = join(root, 'downloads')
    const local = join(downloadDir, 'episode.mp3')
    const imported = join(root, 'library', 'old.mp3')
    await mkdir(downloadDir)
    await mkdir(join(root, 'library'))
    await writeFile(local, 'audio')
    await writeFile(imported, 'audio')

    const allowed = await authorizeLocalFile({
      filePath: local,
      downloadDir,
      imported: false
    })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.path).toBe(local)

    const missing = await authorizeLocalFile({
      filePath: join(downloadDir, 'gone.mp3'),
      downloadDir,
      imported: false
    })
    expect(missing).toEqual({ ok: false, status: 404 })

    const notes = join(downloadDir, 'notes.txt')
    await writeFile(notes, 'text')
    const notAudio = await authorizeLocalFile({
      filePath: notes,
      downloadDir,
      imported: false
    })
    expect(notAudio).toEqual({ ok: false, status: 403 })

    const libraryFile = await authorizeLocalFile({
      filePath: imported,
      downloadDir,
      imported: true
    })
    expect(libraryFile.ok).toBe(true)
  })
})

describe('remote playback URLs', () => {
  it('allows only http and https media URLs', () => {
    expect(httpMediaUrl('https://cdn.example/ep.mp3')).toBe('https://cdn.example/ep.mp3')
    expect(httpMediaUrl('http://cdn.example/ep.mp3')).toBe('http://cdn.example/ep.mp3')
    expect(httpMediaUrl('file:///tmp/ep.mp3')).toBeNull()
    expect(httpMediaUrl('javascript:alert(1)')).toBeNull()
    expect(httpMediaUrl('data:audio/mpeg;base64,AA==')).toBeNull()
    expect(httpMediaUrl(null)).toBeNull()
  })
})

describe('network scheme checks', () => {
  it('rejects non-http schemes for feeds, chapters, and downloads', async () => {
    await expect(fetchFeed('file:///tmp/feed.xml')).rejects.toBeInstanceOf(FeedError)
    await expect(fetchFeed('file:///tmp/feed.xml')).rejects.toThrow(/Unsupported protocol: file:/)
    await expect(fetchChapters('ftp://example.com/chapters.json')).rejects.toThrow(
      /Unsupported protocol: ftp:/
    )
    const root = await tempDir()
    await expect(
      downloadFile({ url: 'file:///tmp/episode.mp3', destination: join(root, 'episode.mp3') })
    ).rejects.toThrow(/Unsupported protocol: file:/)
  })

  it('rejects a redirect to a non-http scheme', async () => {
    const base = await listen()
    await expect(fetchHttp(`${base}/to-file`)).rejects.toThrow(/Unsupported protocol: file:/)
    await expect(fetchFeed(`${base}/to-ftp`)).rejects.toThrow(/Unsupported protocol: ftp:/)
    await expect(fetchChapters(`${base}/to-file`)).rejects.toThrow(/Unsupported protocol: file:/)
    const root = await tempDir()
    await expect(
      downloadFile({ url: `${base}/to-file`, destination: join(root, 'episode.mp3') })
    ).rejects.toThrow(/Unsupported protocol: file:/)

    const result = await fetchFeed(`${base}/to-ok`)
    expect(result.feed?.title).toBe('Ok')
  })
})

describe('feed size limit', () => {
  it('aborts a feed body larger than 10 MB', async () => {
    const base = await listen()
    await expect(fetchFeed(`${base}/huge`)).rejects.toThrow(
      new RegExp(`Response exceeded ${MAX_FEED_BYTES} bytes`)
    )
  })
})
