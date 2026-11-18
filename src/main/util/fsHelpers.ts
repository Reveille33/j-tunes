import { mkdir, rename, unlink, stat, readdir, copyFile } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'

/** Characters that are illegal in filenames on Windows, macOS or Linux. */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g
/** ASCII control characters, which some filesystems reject outright. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
/** Windows reserved file and device names. */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Removes characters that are illegal or awkward in filenames, collapses
 * whitespace, trims trailing dots and spaces (Windows silently strips or rejects them),
 * and prevents Windows reserved device names.
 */
export function sanitiseFileName(name: string, maxLength = 100): string {
  let cleaned = name
    .replace(CONTROL_CHARS, '')
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .replace(/[. ]+$/, '')

  if (!cleaned) return 'untitled'

  if (WINDOWS_RESERVED_NAMES.test(cleaned)) {
    cleaned = `_${cleaned}`
  }

  return cleaned
}

/** Returns the lowercase extension including the dot, e.g. `.mp3`. */
export function fileExtension(path: string): string {
  return extname(path).toLowerCase()
}

/** True when the path exists on disk. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Creates a directory (and its parents) if it does not already exist. */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/**
 * Builds a unique file path by appending ` (2)`, ` (3)` ... when the
 * candidate path is already taken.
 */
export async function uniquePath(dir: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)

  let candidate = join(dir, fileName)
  let counter = 2
  while (await pathExists(candidate)) {
    candidate = join(dir, `${stem} (${counter})${ext}`)
    counter += 1
    if (counter > 999) break
  }
  return candidate
}

/**
 * Picks a path that `taken` rejects, appending ` (2)`, ` (3)` ... as needed.
 *
 * The check is synchronous so a caller can claim the path before yielding.
 * Downloads use it to treat in-flight destinations as taken, not only files
 * that already exist on disk.
 */
export function reserveUniquePath(
  dir: string,
  fileName: string,
  taken: (candidate: string) => boolean
): string {
  const ext = extname(fileName)
  const stem = basename(fileName, ext)

  let candidate = join(dir, fileName)
  let counter = 2
  while (taken(candidate)) {
    candidate = join(dir, `${stem} (${counter})${ext}`)
    counter += 1
    if (counter > 999) break
  }
  return candidate
}

/**
 * Moves a file to its final name, replacing any existing file at the target.
 * A rename across device boundaries falls back to copy + delete.
 */
export async function moveFile(from: string, to: string): Promise<void> {
  await ensureDir(dirname(to))
  if (await pathExists(to)) {
    await unlink(to).catch(() => undefined)
  }
  try {
    await rename(from, to)
  } catch {
    await copyFile(from, to)
    await unlink(from).catch(() => undefined)
  }
}

/** Recursively lists files under a directory, optionally filtered. */
export async function listFilesRecursive(
  dir: string,
  filter?: (path: string) => boolean
): Promise<string[]> {
  const results: string[] = []

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(full, filter)))
    } else if (entry.isFile()) {
      if (!filter || filter(full)) results.push(full)
    }
  }

  return results
}

/** Returns the size of a file in bytes, or 0 when it cannot be read. */
export async function fileSize(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return info.size
  } catch {
    return 0
  }
}
