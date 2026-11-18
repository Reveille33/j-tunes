import { create } from 'zustand'
import { defaultSortDirection } from '@shared/sortDirection'
import type { SortBy, SortDirection, Theme } from '@shared/types'

export type ViewFilter = 'all' | 'unplayed' | 'downloaded'

interface UiState {
  theme: Theme
  searchTerm: string
  sortBy: SortBy
  direction: SortDirection
  viewFilter: ViewFilter
  year: number | null
  descriptionTerm: string
  /** Whether descriptions are shown in the list at all. */
  descriptionsVisible: boolean
  /** Ids of episodes whose description is expanded. */
  expandedEpisodes: Set<number>
  sidebarWidth: number
  selectedPodcastId: number | null
  isAddPodcastOpen: boolean
  isImportOpen: boolean
  isSettingsOpen: boolean
  isStatsOpen: boolean
  isStorageOpen: boolean
  isOpmlImportOpen: boolean
  isPaletteOpen: boolean
  isShortcutsOpen: boolean
  /** Episodes ticked for a bulk action. */
  selectedEpisodeIds: Set<number>
  toast: { message: string; kind: 'info' | 'error' | 'success' } | null

  setTheme: (theme: Theme) => void
  setSearchTerm: (term: string) => void
  setSortBy: (sortBy: SortBy) => void
  toggleDirection: () => void
  setViewFilter: (filter: ViewFilter) => void
  setYear: (year: number | null) => void
  setDescriptionTerm: (term: string) => void
  setDescriptionsVisible: (visible: boolean) => void
  toggleEpisodeExpanded: (episodeId: number) => void
  setSidebarWidth: (width: number) => void
  selectPodcast: (podcastId: number | null) => void
  setAddPodcastOpen: (open: boolean) => void
  setImportOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setStatsOpen: (open: boolean) => void
  setStorageOpen: (open: boolean) => void
  setOpmlImportOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  toggleEpisodeSelected: (episodeId: number) => void
  setSelection: (episodeIds: number[]) => void
  clearSelection: () => void
  showToast: (message: string, kind?: 'info' | 'error' | 'success') => void
  hideToast: () => void
}

function themeBeforePaint(): Theme {
  const injected = (globalThis as { jTunesInitialTheme?: unknown }).jTunesInitialTheme
  return injected === 'light' ? 'light' : 'dark'
}

export const useUiStore = create<UiState>((set) => ({
  theme: themeBeforePaint(),
  searchTerm: '',
  sortBy: 'release_date',
  direction: 'desc',
  viewFilter: 'all',
  year: null,
  descriptionTerm: '',
  descriptionsVisible: false,
  expandedEpisodes: new Set<number>(),
  sidebarWidth: 260,
  selectedPodcastId: null,
  isAddPodcastOpen: false,
  isImportOpen: false,
  isSettingsOpen: false,
  isStatsOpen: false,
  isStorageOpen: false,
  isOpmlImportOpen: false,
  isPaletteOpen: false,
  isShortcutsOpen: false,
  selectedEpisodeIds: new Set<number>(),
  toast: null,

  setTheme: (theme) => set({ theme }),
  setSearchTerm: (searchTerm) => set({ searchTerm }),
  setSortBy: (sortBy) => set({ sortBy, direction: defaultSortDirection(sortBy) }),
  toggleDirection: () =>
    set((state) => ({ direction: state.direction === 'asc' ? 'desc' : 'asc' })),
  setViewFilter: (viewFilter) => set({ viewFilter }),
  setYear: (year) => set({ year }),
  setDescriptionTerm: (descriptionTerm) => set({ descriptionTerm }),
  setDescriptionsVisible: (descriptionsVisible) => set({ descriptionsVisible }),
  toggleEpisodeExpanded: (episodeId) =>
    set((state) => {
      const next = new Set(state.expandedEpisodes)
      if (next.has(episodeId)) next.delete(episodeId)
      else next.add(episodeId)
      return { expandedEpisodes: next }
    }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  selectPodcast: (selectedPodcastId) => set({ selectedPodcastId }),
  setAddPodcastOpen: (isAddPodcastOpen) => set({ isAddPodcastOpen }),
  setImportOpen: (isImportOpen) => set({ isImportOpen }),
  setSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
  setStatsOpen: (isStatsOpen) => set({ isStatsOpen }),
  setStorageOpen: (isStorageOpen) => set({ isStorageOpen }),
  setOpmlImportOpen: (isOpmlImportOpen) => set({ isOpmlImportOpen }),
  setPaletteOpen: (isPaletteOpen) => set({ isPaletteOpen }),
  setShortcutsOpen: (isShortcutsOpen) => set({ isShortcutsOpen }),
  toggleEpisodeSelected: (episodeId) =>
    set((state) => {
      const next = new Set(state.selectedEpisodeIds)
      if (next.has(episodeId)) next.delete(episodeId)
      else next.add(episodeId)
      return { selectedEpisodeIds: next }
    }),
  setSelection: (episodeIds) => set({ selectedEpisodeIds: new Set(episodeIds) }),
  clearSelection: () => set({ selectedEpisodeIds: new Set<number>() }),
  showToast: (message, kind = 'info') => set({ toast: { message, kind } }),
  hideToast: () => set({ toast: null })
}))
