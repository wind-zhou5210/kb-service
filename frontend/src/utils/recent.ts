/**
 * 最近阅读 —— 前端本地记录（localStorage，无后端依赖）。
 * 首页知识入口：记录最近看过的文档，支持"继续阅读"。
 */

export interface RecentDoc {
  /** 集合文档 = 数字 document id；工作空间 = 文件路径字符串 */
  id: number | string
  kind: 'collection' | 'workspace'
  title: string
  /** 扩展名（.md / .html / …），无扩展名为 null */
  ext: string | null
  /** 所属集合/工作空间 id */
  sourceId: number
  sourceName: string
  viewedAt: number
  /** 阅读进度比例 0-1（「继续阅读」恢复滚动位置） */
  scrollRatio?: number
}

const KEY = 'kb_recent_docs'
const MAX = 12

export function getRecent(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter(
      (x): x is RecentDoc =>
        !!x && typeof x === 'object' && 'id' in x && 'kind' in x && 'sourceId' in x,
    )
  } catch {
    return []
  }
}

export function trackRecent(item: Omit<RecentDoc, 'viewedAt'>): RecentDoc[] {
  const prev = getRecent()
  // I-1：重新追踪时保留旧条目的 scrollRatio，避免"继续阅读"位置丢失
  const existing = prev.find((x) => x.kind === item.kind && x.id === item.id)
  const next = [
    { ...item, viewedAt: Date.now(), scrollRatio: existing?.scrollRatio },
    ...prev.filter((x) => !(x.kind === item.kind && x.id === item.id)),
  ].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存储不可用（隐私模式/超限）时静默 */
  }
  return next
}

/** 更新某条最近阅读的滚动比例（离开文档时记录，供「继续阅读」恢复位置） */
export function updateRecentScroll(kind: RecentDoc['kind'], id: number | string, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0.01 || ratio >= 0.99) {
    // 顶部/底部不写，避免噪声；0.99 以上视为读完
    return
  }
  const next = getRecent().map((x) =>
    x.kind === kind && x.id === id ? { ...x, scrollRatio: Math.min(0.99, Math.max(0.01, ratio)) } : x,
  )
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
