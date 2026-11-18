import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { partialSize } from '../src/main/services/downloader'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jtunes-dl-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('resumable downloads', () => {
  it('reports the size of a leftover .part file', async () => {
    const destination = join(dir, 'Episode One.mp3')
    await writeFile(`${destination}.part`, Buffer.alloc(1234))
    expect(await partialSize(destination)).toBe(1234)
  })

  it('returns 0 when there is no partial file', async () => {
    expect(await partialSize(join(dir, 'Never Started.mp3'))).toBe(0)
  })

  it('ignores a finished file, resuming only from the .part file', async () => {
    const destination = join(dir, 'Finished.mp3')
    await writeFile(destination, Buffer.alloc(999))
    expect(await partialSize(destination)).toBe(0)
  })
})