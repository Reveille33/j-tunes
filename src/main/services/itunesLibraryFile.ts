import { readFile, stat } from 'node:fs/promises'
import { ITUNES_LIBRARY_MAX_BYTES } from '@shared/constants'
import type { ItunesImportSummary } from '@shared/types'
import {
  importItunesLibrary,
  previewItunesImport,
  type ItunesImportDeps
} from './itunesImport'
import {
  ItunesLibraryTooLargeError,
  parseItunesLibrary,
  type ItunesLibrary
} from './itunesLibrary'

export interface ItunesLibraryFileOptions {
  /** Defaults to `ITUNES_LIBRARY_MAX_BYTES`. Tests pass a smaller cap. */
  maxBytes?: number
}

const MEGABYTE = 1024 * 1024

/**
 * A size the confirm dialog can show. Whole megabytes stay whole; anything
 * over a megabyte rounds up to the next tenth so a file just past the cap
 * does not display as the cap itself.
 */
export function formatLibrarySize(bytes: number): string {
  if (bytes >= MEGABYTE) {
    const tenths = Math.ceil((bytes * 10) / MEGABYTE)
    const whole = Math.floor(tenths / 10)
    const fraction = tenths % 10
    return fraction === 0 ? `${whole} MB` : `${whole}.${fraction} MB`
  }
  return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
}

/** Shown when `stat` reports a file larger than the cap, before the file is read. */
export function itunesLibraryTooLargeMessage(size: number, maxBytes: number): string {
  return `That library is ${formatLibrarySize(size)}, which is over the limit of ${formatLibrarySize(maxBytes)}.`
}

/**
 * Stats the path, refuses anything over the cap, then reads and parses it.
 * The size check happens before `readFile`.
 */
export async function loadItunesLibraryFile(
  filePath: string,
  options: ItunesLibraryFileOptions = {}
): Promise<ItunesLibrary> {
  const maxBytes = options.maxBytes ?? ITUNES_LIBRARY_MAX_BYTES
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(filePath)
  } catch {
    throw new Error('That file could not be read.')
  }
  if (!info.isFile()) {
    throw new Error('Choose an iTunes Library.xml file.')
  }
  if (info.size > maxBytes) {
    throw new Error(itunesLibraryTooLargeMessage(info.size, maxBytes))
  }

  const xml = await readFile(filePath, 'utf8')
  let library: ItunesLibrary
  try {
    library = parseItunesLibrary(xml, { maxBytes })
  } catch (error) {
    if (error instanceof ItunesLibraryTooLargeError) {
      throw new Error(itunesLibraryTooLargeMessage(error.bytes, error.maxBytes))
    }
    throw new Error('That file could not be read as an iTunes library.')
  }
  if (library.shows.length === 0) {
    throw new Error('No podcasts were found in that file.')
  }
  return library
}

/** Parses a Library.xml and summarises the import. Does not write. */
export async function previewItunesLibraryFile(
  deps: ItunesImportDeps,
  filePath: string,
  options?: ItunesLibraryFileOptions
): Promise<ItunesImportSummary> {
  const library = await loadItunesLibraryFile(filePath, options)
  return previewItunesImport(deps, library)
}

/** Parses a Library.xml and imports it. */
export async function importItunesLibraryFile(
  deps: ItunesImportDeps,
  filePath: string,
  options?: ItunesLibraryFileOptions
): Promise<ItunesImportSummary> {
  const library = await loadItunesLibraryFile(filePath, options)
  return importItunesLibrary(deps, library)
}
