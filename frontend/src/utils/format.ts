/**
 * 格式化工具函数
 */

/** 文件大小格式化 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 相对时间格式化（"3天前"） */
export function relativeTime(iso: string): string {
  // SQLite 存储时不保留时区信息，读回的 naive datetime 需按 UTC 解析
  const normalized = iso.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z'
  const now = Date.now()
  const then = new Date(normalized).getTime()
  const diff = now - then
  const sec = Math.floor(diff / 1000)
  const min = Math.floor(sec / 60)
  const hour = Math.floor(min / 60)
  const day = Math.floor(hour / 24)
  if (day > 30) return new Date(normalized).toLocaleDateString('zh-CN')
  if (day > 0) return `${day} 天前`
  if (hour > 0) return `${hour} 小时前`
  if (min > 0) return `${min} 分钟前`
  return '刚刚'
}

/** 预设渐变色对，基于名称 hash 选取 */
const GRADIENTS: [string, string][] = [
  ['#667eea', '#764ba2'],
  ['#4F46E5', '#7C3AED'],
  ['#0EA5E9', '#2563EB'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#EF4444'],
  ['#EC4899', '#8B5CF6'],
  ['#14B8A6', '#0EA5E9'],
  ['#6366F1', '#A855F7'],
  ['#F97316', '#EAB308'],
  ['#06B6D4', '#3B82F6'],
]

/** 基于名称生成稳定的渐变色（用于集合封面、头像等） */
export function hashGradient(name: string): [string, string] {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]
}

/** 取名称首字（用于头像） */
export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // 中文取第一个字，英文取首字母
  return trimmed[0].toUpperCase()
}
