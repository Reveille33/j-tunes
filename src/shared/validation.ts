/**
 * Zod schemas validating every IPC payload crossing the process boundary.
 * Used on both ends: the renderer validates before sending, the main process
 * validates before acting.
 */
import { z } from 'zod'

export const idSchema = z.number().int().positive()

export const fileActionSchema = z.enum(['keep', 'trash'])

export const themeSchema = z.enum(['dark', 'light'])

export const sortBySchema = z.enum(['release_date', 'title', 'duration', 'podcast', 'relevance'])

export const sortDirectionSchema = z.enum(['asc', 'desc'])

export const downloadStateSchema = z.enum([
  'none',
  'queued',
  'downloading',
  'paused',
  'done',
  'error'
])

export const episodeQuerySchema = z.object({
  filters: z
    .object({
      podcastId: idSchema.nullish(),
      year: z.number().int().min(1970).max(3000).nullish(),
      played: z.boolean().nullish(),
      downloadState: downloadStateSchema.nullish(),
      descriptionTerm: z.string().max(500).nullish(),
      text: z.string().max(500).nullish()
    })
    .optional(),
  sortBy: sortBySchema.optional(),
  direction: sortDirectionSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional()
})

export const subscribeSchema = z.object({
  feedUrl: z.string().min(4).max(2048)
})

export const unsubscribeSchema = z.object({
  podcastId: idSchema,
  fileAction: fileActionSchema
})

export const setAutoDownloadSchema = z.object({
  podcastId: idSchema,
  autoDownload: z.boolean()
})

export const setPlayedSchema = z.object({
  episodeId: idSchema,
  played: z.boolean()
})

export const episodeIdSchema = z.object({
  episodeId: idSchema
})

export const podcastIdSchema = z.object({
  podcastId: idSchema
})

export const savePositionSchema = z.object({
  episodeId: idSchema,
  position: z.number().min(0).max(60 * 60 * 24),
  duration: z.number().min(0).max(60 * 60 * 24)
})

export const importSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(500)
})

export const searchFeedSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).optional()
})

export const bulkPlayedSchema = z.object({
  podcastId: idSchema.nullish(),
  episodeIds: z.array(idSchema).max(5000).nullish(),
  played: z.boolean(),
  onlyUnplayed: z.boolean().optional()
})

export const queueAddManySchema = z.object({
  episodeIds: z.array(idSchema).max(2000)
})

const playlistEpisodeIdsSchema = z.array(idSchema).min(1).max(2000)

/** Adds episodes to a playlist, or creates the playlist and then adds them. */
export const playlistAddSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('existing'),
    playlistId: idSchema,
    episodeIds: playlistEpisodeIdsSchema
  }),
  z.object({
    target: z.literal('new'),
    name: z.string().trim().min(1).max(200),
    episodeIds: playlistEpisodeIdsSchema
  })
])

export const episodeContextMenuSchema = z.object({
  episodeIds: playlistEpisodeIdsSchema
})

export type PlaylistAddInput = z.infer<typeof playlistAddSchema>

export const queueReorderSchema = z.object({
  episodeIds: z.array(idSchema).max(2000)
})

export const deleteDownloadSchema = z.object({
  episodeId: idSchema,
  fileAction: fileActionSchema
})

export const deleteDownloadsSchema = z.object({
  episodeIds: z.array(idSchema).max(5000).nullish(),
  podcastId: idSchema.nullish(),
  fileAction: fileActionSchema
})

export const settingKeySchema = z.enum([
  'theme',
  'downloadDir',
  'autoDownloadDefault',
  'globalDescriptionsVisible',
  'showFullDescriptions',
  'lastPlaybackSpeed',
  'defaultVolume',
  'checkUpdatesOnStartup',
  'notifyOnNewEpisodes'
])

export const settingsSetSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('theme'), value: themeSchema }),
  z.object({ key: z.literal('downloadDir'), value: z.string().max(4096) }),
  z.object({ key: z.literal('autoDownloadDefault'), value: z.boolean() }),
  z.object({ key: z.literal('globalDescriptionsVisible'), value: z.boolean() }),
  z.object({ key: z.literal('showFullDescriptions'), value: z.boolean() }),
  z.object({ key: z.literal('lastPlaybackSpeed'), value: z.number().min(0.5).max(4) }),
  z.object({ key: z.literal('defaultVolume'), value: z.number().min(0).max(1) }),
  z.object({ key: z.literal('checkUpdatesOnStartup'), value: z.boolean() }),
  z.object({ key: z.literal('notifyOnNewEpisodes'), value: z.boolean() })
])

export type EpisodeQueryInput = z.infer<typeof episodeQuerySchema>
