import { useLocation, useNavigate } from 'react-router-dom'
import { Breadcrumb } from 'antd'
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

  if (crumbs.length === 0) return null

  // 移动端仅显示最后两段
  if (isMobile && crumbs.length > 2) {
    crumbs = [{ title: '…' }, ...crumbs.slice(-2)]
  }

  return (
    <Breadcrumb
      style={{ fontSize: 13 }}
      items={crumbs.map((c) => ({
        title: c.onClick
          ? <span style={{ cursor: 'pointer' }} onClick={c.onClick}>{c.title}</span>
          : c.title,
      }))}
    />
  )
}
