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
  },
}))
