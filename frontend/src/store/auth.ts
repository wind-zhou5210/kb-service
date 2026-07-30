import { create } from 'zustand'

interface AuthState {
  token: string | null
  setToken: (t: string | null) => void
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem('kb_token'),
  setToken: (t) => {
    if (t) localStorage.setItem('kb_token', t)
    else localStorage.removeItem('kb_token')
    set({ token: t })
  },
  logout: () => {
    localStorage.removeItem('kb_token')
    set({ token: null })
    // 清空业务缓存，防止换账号后残留旧数据
    import('./workspace').then((m) => m.useWorkspaceStore.getState().reset())
    import('./collection').then((m) => m.useCollectionStore.getState().reset())
  },
}))
