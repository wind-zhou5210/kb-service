import { create } from 'zustand'
import { api, type Collection } from '../api/client'

interface CollectionStore {
  list: Collection[]
  loaded: boolean
  current: Collection | null
  fetchList: (force?: boolean) => Promise<void>
  mutate: () => Promise<void>
  setCurrent: (c: Collection | null) => void
  reset: () => void
}

export const useCollectionStore = create<CollectionStore>((set, get) => ({
  list: [],
  loaded: false,
  current: null,
  fetchList: async (force = false) => {
    if (get().loaded && !force) return
    const list = await api.listCollections()
    set({ list, loaded: true })
  },
  mutate: async () => {
    const list = await api.listCollections()
    set({ list, loaded: true })
  },
  setCurrent: (c) => set({ current: c }),
  reset: () => set({ list: [], loaded: false, current: null }),
}))
