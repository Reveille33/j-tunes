import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import type { Db } from '../db/connection'
import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { PodcastFolderRepo } from '../db/repositories/podcastFolderRepo'
import type { PodcastRepo } from '../db/repositories/podcastRepo'
import type { ItunesEpisode, ItunesLibrary, ItunesShow } from './itunesLibrary'
import { feedIsHttp } from './folderScan'
import { normaliseTitle } from './importer'
import { fileSize } from '../util/fsHelpers'

export interface ItunesImportDeps {
  db: Db
  podcasts: PodcastRepo
  episodes: EpisodeRepo
  folders: PodcastFolderRepo
}

export interface ItunesImportSummary {
  showsCreated: number
  showsMatched: number
  episodesCreated: number
  episodesMatched: number
  /** Newly created episodes written as played. */
  played: number
  /** Incoming episodes with no file on disk, including http locations. */
  missingFiles: number
  /** Shows that carried an http(s) feed URL. The URL is not written. */
  feedUrlsSeen: number
}

interface KnownShow {
  id: number
  feedUrl: string | null
  titleKey: string
}

interface MatchRow {
  id: number
  guid: string
  title: string
  filePath: string | null
}

interface EpisodeIndex {
  byPath: Map<string, MatchRow>
  byGuid: Map<string, MatchRow>
  byTitle: Map<string, MatchRow[]>
}

interface ResolvedEpisode {
  episode: ItunesEpisode
  filePath: string | null
  fileSize: number
}

interface ShowPlan {
  existingId: number | null
  title: string
  author: string | null
  folders: string[]
  episodes: EpisodePlan[]
}

type EpisodePlan =
  | {
      kind: 'create'
      episode: ItunesEpisode
      filePath: string | null
      fileSize: number
    }
  | {
      kind: 'match'
      episodeId: number
      attach: { filePath: string; fileSize: number; durationSecs: number | null } | null
    }

interface ImportPlan {
  summary: ItunesImportSummary
  shows: ShowPlan[]
}

/**
 * Computes the import summary without writing.
 * The confirm step can show this before `importItunesLibrary` runs.
 */
export async function previewItunesImport(
  deps: ItunesImportDeps,
  library: ItunesLibrary
): Promise<ItunesImportSummary> {
  const plan = await planItunesImport(deps, library)
  return plan.summary
}

/**
 * Writes a parsed iTunes library in one transaction.
 *
 * Shows are local-only: feed URLs are counted and not stored, and
 * auto-download is off. Nothing here fetches a feed.
 */
export async function importItunesLibrary(
  deps: ItunesImportDeps,
  library: ItunesLibrary
): Promise<ItunesImportSummary> {
  const plan = await planItunesImport(deps, library)
  deps.db.transaction(() => {
    applyItunesImport(deps, plan)
  })()
  return plan.summary
}

async function planItunesImport(
  deps: ItunesImportDeps,
  library: ItunesLibrary
): Promise<ImportPlan> {
  const resolved = await Promise.all(library.shows.map((show) => resolveShow(show)))
  const folderChoices = exclusiveFolders(resolved.map((show) => show.files))
  const known: KnownShow[] = deps.podcasts.list(true).map((podcast) => ({
    id: podcast.id,
    feedUrl: podcast.feedUrl,
    titleKey: normaliseTitle(podcast.title)
  }))

  const summary: ItunesImportSummary = {
    showsCreated: 0,
    showsMatched: 0,
    episodesCreated: 0,
    episodesMatched: 0,
    played: 0,
    missingFiles: resolved.reduce(
      (sum, show) => sum + show.episodes.filter((episode) => episode.filePath == null).length,
      0
    ),
    feedUrlsSeen: library.shows.filter((show) => feedIsHttp(show.feedUrl)).length
  }
  const shows: ShowPlan[] = []

  resolved.forEach((show, index) => {
    const existingId = matchShow(show.show, known)
    if (existingId == null) summary.showsCreated += 1
    else summary.showsMatched += 1

    const indexRows = existingId == null ? [] : deps.episodes.listForShowMatch(existingId)
    const episodeIndex = buildEpisodeIndex(indexRows)
    const claimedPaths = new Set<string>()
    const claimedGuids = new Set<string>()
    const episodes: EpisodePlan[] = []

    for (const item of show.episodes) {
      const claimed =
        claimedGuids.has(item.episode.guid) ||
        (item.filePath != null && claimedPaths.has(item.filePath))
      const match = claimed ? null : findEpisode(episodeIndex, item)
      claimedGuids.add(item.episode.guid)
      if (item.filePath) claimedPaths.add(item.filePath)

      if (match) {
        summary.episodesMatched += 1
        const attach =
          match.filePath == null && item.filePath
            ? {
                filePath: item.filePath,
                fileSize: item.fileSize,
                durationSecs: item.episode.durationSecs
              }
            : null
        consumeEpisode(episodeIndex, match)
        if (attach) {
          match.filePath = attach.filePath
          episodeIndex.byPath.set(attach.filePath, match)
        }
        episodes.push({ kind: 'match', episodeId: match.id, attach })
        continue
      }
      if (claimed) {
        summary.episodesMatched += 1
        continue
      }

      summary.episodesCreated += 1
      if (item.episode.played) summary.played += 1
      episodes.push({
        kind: 'create',
        episode: item.episode,
        filePath: item.filePath,
        fileSize: item.fileSize
      })
    }

    const folders = (folderChoices[index] ?? []).filter(
      (path) => deps.folders.findByPath(path) == null
    )
    shows.push({
      existingId,
      title: show.show.name,
      author: show.show.author,
      folders,
      episodes
    })
  })

  return { summary, shows }
}

function applyItunesImport(deps: ItunesImportDeps, plan: ImportPlan): void {
  for (const show of plan.shows) {
    const created =
      show.existingId == null
        ? deps.podcasts.create({
            feedUrl: null,
            title: show.title,
            author: show.author,
            autoDownload: false
          })
        : null
    const podcastId = created?.id ?? show.existingId
    if (podcastId == null) continue

    for (const episode of show.episodes) {
      if (episode.kind === 'create') {
        const id = deps.episodes.insertImported({
          podcastId,
          guid: episode.episode.guid,
          title: episode.episode.title,
          durationSecs: episode.episode.durationSecs,
          releaseDate: episode.episode.releaseDate,
          filePath: episode.filePath,
          fileSize: episode.filePath ? episode.fileSize : null
        })
        deps.episodes.setPlayState(
          id,
          episode.episode.played,
          episode.episode.positionSecs,
          episode.filePath == null
        )
        continue
      }

      if (episode.attach == null) continue
      deps.episodes.attachFile(
        episode.episodeId,
        episode.attach.filePath,
        episode.attach.fileSize,
        episode.attach.durationSecs
      )
    }

    for (const path of show.folders) {
      if (deps.folders.findByPath(path)) continue
      deps.folders.add(podcastId, path)
    }
    deps.podcasts.refreshCounters(podcastId)
  }
}

async function resolveShow(
  show: ItunesShow
): Promise<{ show: ItunesShow; episodes: ResolvedEpisode[]; files: string[] }> {
  const episodes: ResolvedEpisode[] = []
  const files: string[] = []
  for (const episode of show.episodes) {
    const filePath = await resolveFile(episode.filePath)
    const size = filePath ? await fileSize(filePath) : 0
    episodes.push({ episode, filePath, fileSize: size })
    if (filePath) files.push(filePath)
  }
  return { show, episodes, files }
}

async function resolveFile(filePath: string | null): Promise<string | null> {
  if (!filePath) return null
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null
    return await realpath(filePath)
  } catch {
    return null
  }
}

/**
 * Exact http(s) feed match first. Otherwise one normalised title.
 * Zero or several title matches create a new show, so episodes never
 * land on an arbitrary one.
 */
function matchShow(show: ItunesShow, known: KnownShow[]): number | null {
  if (feedIsHttp(show.feedUrl)) {
    const byFeed = known.find((podcast) => podcast.feedUrl === show.feedUrl)
    if (byFeed) return byFeed.id
  }
  const key = normaliseTitle(show.name)
  if (!key) return null
  const byTitle = known.filter((podcast) => podcast.titleKey === key)
  if (byTitle.length === 1) return byTitle[0].id
  return null
}

function buildEpisodeIndex(rows: MatchRow[]): EpisodeIndex {
  const index: EpisodeIndex = { byPath: new Map(), byGuid: new Map(), byTitle: new Map() }
  for (const row of rows) {
    if (row.filePath) index.byPath.set(row.filePath, row)
    index.byGuid.set(row.guid, row)
    const key = normaliseTitle(row.title)
    if (!key) continue
    const list = index.byTitle.get(key)
    if (list) list.push(row)
    else index.byTitle.set(key, [row])
  }
  return index
}

function findEpisode(index: EpisodeIndex, item: ResolvedEpisode): MatchRow | null {
  if (item.filePath) {
    const byPath = index.byPath.get(item.filePath)
    if (byPath) return byPath
  }
  const byGuid = index.byGuid.get(item.episode.guid)
  if (byGuid) return byGuid
  const key = normaliseTitle(item.episode.title)
  if (!key) return null
  const titled = index.byTitle.get(key)
  if (titled && titled.length === 1) return titled[0]
  return null
}

function consumeEpisode(index: EpisodeIndex, row: MatchRow): void {
  if (row.filePath && index.byPath.get(row.filePath) === row) index.byPath.delete(row.filePath)
  if (index.byGuid.get(row.guid) === row) index.byGuid.delete(row.guid)
  const key = normaliseTitle(row.title)
  const titled = key ? index.byTitle.get(key) : undefined
  if (!titled) return
  const next = titled.filter((item) => item !== row)
  if (next.length > 0) index.byTitle.set(key, next)
  else index.byTitle.delete(key)
}

/**
 * A folder is attached only when every imported file under it belongs to
 * one show. Shared directories and directories that contain another show
 * are skipped. A nested directory is skipped when its parent is already
 * exclusive to the same show, because folder scans are recursive.
 */
function exclusiveFolders(filesByShow: string[][]): string[][] {
  const owners = filesByShow.flatMap((files, show) => files.map((file) => ({ show, file })))
  return filesByShow.map((files, show) => {
    const candidates = [
      ...new Set(files.map((file) => dirname(file)).filter((dir) => !isFsRoot(dir)))
    ]
    const exclusive = candidates.filter((dir) =>
      owners.every((owner) => owner.show === show || !containsPath(dir, owner.file))
    )
    return outermost(exclusive)
  })
}

function outermost(dirs: string[]): string[] {
  return dirs.filter((dir) => !dirs.some((other) => other !== dir && containsPath(other, dir)))
}

function containsPath(parent: string, target: string): boolean {
  const rel = relative(parent, target)
  if (rel === '') return true
  if (rel === '..' || rel.startsWith(`..${sep}`)) return false
  return !isAbsolute(rel)
}

function isFsRoot(dir: string): boolean {
  return dirname(dir) === dir
}
