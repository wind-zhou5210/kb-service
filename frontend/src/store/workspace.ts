import { create } from 'zustand'
import { api, type Workspace } from '../api/client'

interface WorkspaceStore {
  list: Workspace[]
  loaded: boolean
  current: Workspace | null
  fetchList: (force?: boolean) => Promise<void>
  mutate: () => Promise<void>
  setCurrent: (ws: Workspace | null) => void
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  list: [],
  loaded: false,
  current: null,
  fetchList: async (force = false) => {
    if (get().loaded && !force) return
    const list = await api.listWorkspaces()
    set({ list, loaded: true })
  },
  mutate: async () => {
    const list = await api.listWorkspaces()
    set({ list, loaded: true })
  },
  setCurrent: (ws) => set({ current: ws }),
  reset: () => set({ list: [], loaded: false, current: null }),
}))
