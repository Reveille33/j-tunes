import { create } from 'zustand'
import type { Episode } from '@shared/types'

interface QueueState {
  items: Episode[]
  loading: boolean

  load: () => Promise<void>
  add: (episodeId: number) => Promise<void>
  addMany: (episodeIds: number[]) => Promise<void>
  remove: (episodeId: number) => Promise<void>
  move: (episodeId: number, direction: -1 | 1) => Promise<void>
  clear: () => Promise<void>
}

/**
 * The "Up Next" queue, mirrored from the database.
 *
 * The main process owns the ordering; the store is a render-friendly copy that
 * is refreshed after every mutation so the sidebar and player agree.
 */
export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const items = await window.api.listQueue()
      set({ items, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  add: async (episodeId) => {
    await window.api.addToQueue(episodeId)
    await get().load()
  },

  addMany: async (episodeIds) => {
    if (episodeIds.length === 0) return
    await window.api.addManyToQueue(episodeIds)
    await get().load()
  },

  remove: async (episodeId) => {
    await window.api.removeFromQueue(episodeId)
    await get().load()
  },

  /** Moves an episode one slot up or down, persisting the new order. */
  move: async (episodeId, direction) => {
    const items = get().items
    const index = items.findIndex((item) => item.id === episodeId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= items.length) return

    const next = items.slice()
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    set({ items: next })

    try {
      await window.api.reorderQueue(next.map((item) => item.id))
    } catch {
      // Fall back to the persisted order if the write failed.
      await get().load()
    }
  },

  clear: async () => {
    await window.api.clearQueue()
    set({ items: [] })
  }
}))