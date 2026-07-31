import { useEffect, useState } from 'react'

/** 响应式断点检测：返回给定 media query 当前是否匹配，随窗口变化更新 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 常用移动端断点（与 index.css 的 768px 一致） */
export const useIsMobile = () => useMediaQuery('(max-width: 768px)')
