import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'

const require = createRequire(import.meta.url)
const { archName, prebuildFile, stageSqlite, beforePack } = require('../scripts/stage-sqlite.cjs') as {
  archName: (arch: number | string) => string | null
  prebuildFile: (platform: string, arch: number | string) => string
  stageSqlite: (moduleRoot: string, platform: string, arch: number | string) => string
  beforePack: (context: { electronPlatformName: string; arch: number }) => Promise<void>
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-stage-'))
  const prebuilds = join(root, 'prebuilds')
  mkdirSync(prebuilds)
  writeFileSync(join(prebuilds, 'darwin-arm64.node'), 'arm64-bytes')
  writeFileSync(join(prebuilds, 'darwin-x64.node'), 'x64-bytes')
  return root
}

describe('stage better-sqlite3 per arch', () => {
  it('names the prebuild for arm64 and x64 only', () => {
    expect(archName(3)).toBe('arm64')
    expect(archName(1)).toBe('x64')
    expect(archName('arm64')).toBe('arm64')
    expect(archName(4)).toBeNull()
    expect(prebuildFile('darwin', 3)).toBe('darwin-arm64.node')
    expect(prebuildFile('darwin', 'x64')).toBe('darwin-x64.node')
    expect(() => prebuildFile('darwin', 4)).toThrow(/no darwin prebuild/)
  })

  it('copies the matching prebuild into the path the module loads', () => {
    const root = fixture()
    try {
      const arm = stageSqlite(root, 'darwin', 3)
      expect(readFileSync(arm, 'utf8')).toBe('arm64-bytes')
      const x64 = stageSqlite(root, 'darwin', 'x64')
      expect(readFileSync(x64, 'utf8')).toBe('x64-bytes')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails when that arch has no prebuild', () => {
    const root = mkdtempSync(join(tmpdir(), 'sqlite-stage-'))
    try {
      expect(() => stageSqlite(root, 'darwin', 'arm64')).toThrow(/Missing prebuilds\/darwin-arm64.node/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not stage a binary for the Windows packager', async () => {
    await expect(beforePack({ electronPlatformName: 'win32', arch: 1 })).resolves.toBeUndefined()
  })
})
