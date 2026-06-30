import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
}

function getStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function setStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* ignore */ }
}

function getInitialTheme(): Theme {
  const stored = getStorage('kb-theme')
  if (stored === 'dark' || stored === 'light') return stored
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

const initial = getInitialTheme()
applyTheme(initial)

export const useTheme = create<ThemeState>((set) => ({
  theme: initial,
  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'light' ? 'dark' : 'light'
      setStorage('kb-theme', next)
      applyTheme(next)
      return { theme: next }
    }),
}))
