import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkspaceStore } from '../store/workspace'
import { useCollectionStore } from '../store/collection'
import { useIsMobile } from '../hooks/useMediaQuery'

export default function Breadcrumbs() {
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const ws = useWorkspaceStore((s) => s.current)
  const col = useCollectionStore((s) => s.current)
  const path = location.pathname

  type Crumb = { title: string; onClick?: () => void }
  let crumbs: Crumb[] = []

  if (path === '/' || path.startsWith('/collections')) {
    crumbs.push({ title: '知识集合', onClick: () => navigate('/') })
    if (path.startsWith('/collections/') && col) crumbs.push({ title: col.name })
  } else if (path.startsWith('/workspaces')) {
    crumbs.push({ title: '工作空间', onClick: () => navigate('/workspaces') })
    if (path.startsWith('/workspaces/') && ws) crumbs.push({ title: ws.name })
  }

  // 根级列表页只有一段，与顶栏 Tab 重复，不渲染
  if (crumbs.length <= 1) return null

  // 移动端仅显示最后两段
  if (isMobile && crumbs.length > 2) {
    crumbs = [{ title: '…' }, ...crumbs.slice(-2)]
  }

  const segStyle: React.CSSProperties = {
    maxWidth: '40vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-base)' }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {i > 0 && <span style={{ color: 'var(--ink-300)' }}>/</span>}
            {isLast ? (
              <span style={{ ...segStyle, color: 'var(--ink-900)', fontWeight: 500 }}>{c.title}</span>
            ) : (
              <span
                className="crumb-link"
                onClick={c.onClick}
                style={{
                  ...segStyle,
                  color: 'var(--ink-400)',
                  cursor: c.onClick ? 'pointer' : 'default',
                  transition: 'color 0.15s var(--ease)',
                }}
              >
                {c.title}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
