import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Skeleton, message, Drawer, Button } from 'antd'
import { FolderOutlined, LockOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined } from '@ant-design/icons'
import { api, type Workspace, type WorkspaceTreeNode } from '../api/client'
import { formatSize } from '../utils/format'
import WorkspaceTree from '../components/WorkspaceTree'
import HtmlSandbox from '../components/HtmlSandbox'
import MarkdownViewer from '../components/MarkdownViewer'
import EmptyState from '../components/EmptyState'
import { useIsMobile } from '../hooks/useMediaQuery'

const SIDEBAR_COLLAPSED_KEY = 'kb_shared_ws_sidebar_collapsed'

export default function SharedWorkspace() {
  const { token } = useParams<{ token: string }>()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [htmlSrc, setHtmlSrc] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  // 侧栏收起状态：持久化到 localStorage，刷新后保持（仅桌面端）
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
  // 移动端：目录树改为 Drawer 呈现
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, c ? '0' : '1')
      return !c
    })
  }

  // Load workspace info and tree via share token
  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(false)
    try {
      const [ws, treeData] = await Promise.all([
        api.getSharedWorkspace(token),
        api.getSharedWorkspaceTree(token),
      ])
      setWorkspace(ws)
      setTree(treeData)
      // Auto-select first file
      if (!selectedFile && treeData.length > 0) {
        const first = findFirstFile(treeData)
        if (first) setSelectedFile(first)
      }
    } catch {
      setError(true)
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  // Load file content when selectedFile changes
  useEffect(() => {
    if (!selectedFile || !token) { setMdContent(''); setHtmlSrc(''); return }
    const isMd = selectedFile.endsWith('.md')
    const isHtml = selectedFile.endsWith('.html') || selectedFile.endsWith('.htm')
    if (!isMd && !isHtml) { setMdContent(''); setHtmlSrc(''); return }

    setContentLoading(true)
    if (isMd) {
      fetch(`/api/workspaces/share/${token}/serve/${selectedFile}?render=md`)
        .then(r => r.text())
        .then(text => { setMdContent(text); setHtmlSrc('') })
        .catch(() => message.error('加载文件失败'))
        .finally(() => setContentLoading(false))
    } else {
      setHtmlSrc(`/api/workspaces/share/${token}/serve/${selectedFile}`)
      setMdContent('')
      setContentLoading(false)
    }
  }, [selectedFile, token])

  // Auto-refresh when navigate event fires from iframe
  useEffect(() => {
    if (!token) return
    const handler = (e: CustomEvent) => {
      const path = e.detail
      if (typeof path === 'string') {
        const servePrefix = `/api/workspaces/share/${token}/serve/`
        if (path.includes(servePrefix)) {
          const filePath = path.split(servePrefix)[1]
          if (filePath) setSelectedFile(decodeURIComponent(filePath))
        }
      }
    }
    window.addEventListener('ws-navigate', handler as EventListener)
    return () => window.removeEventListener('ws-navigate', handler as EventListener)
  }, [token])

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin /></div>
  }

  if (error || !workspace) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 12 }}>
        <EmptyState icon={<LockOutlined />} title="分享链接无效或已失效" description="该工作空间的分享链接不存在或已被撤销" />
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const servePrefix = `/api/workspaces/share/${token}/serve/`
  const isMd = selectedFile?.endsWith('.md') ?? false
  const isHtml = selectedFile?.endsWith('.html') ?? selectedFile?.endsWith('.htm') ?? false

  // 目录树选中：移动端选中后自动关闭 Drawer
  const handleSelectFile = (path: string) => {
    setSelectedFile(path)
    if (isMobile) setDrawerOpen(false)
  }

  // 侧栏内容：桌面端放 aside，移动端放 Drawer
  const sidebarContent = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--subtle-border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)', marginBottom: 4 }}>{workspace.name}</div>
        {workspace.description && (
          <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 4 }}>{workspace.description}</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
          {workspace.file_count} 个文件 · {formatSize(workspace.total_size)}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-300)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <LockOutlined /> 只读分享
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 4px' }}>
        <WorkspaceTree treeData={tree} selectedFile={selectedFile || undefined} onSelect={handleSelectFile} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* 顶部工具条：折叠按钮 + 工作空间名 + 只读标识 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {isMobile ? (
          <Button type="text" size="small" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开目录" />
        ) : (
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSidebar}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          />
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-300)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <LockOutlined /> 只读分享
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 桌面端左栏：目录树（可收起） */}
        {!isMobile && (
          <aside style={{ width: collapsed ? 0 : 280, borderRight: collapsed ? 'none' : '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ width: 280, height: '100%', transition: 'opacity 0.18s var(--ease)', opacity: collapsed ? 0 : 1 }}>
              {sidebarContent}
            </div>
          </aside>
        )}

        {/* 移动端：目录树 Drawer */}
        {isMobile && (
          <Drawer
            title="目录"
            placement="left"
            width="min(320px, 85vw)"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            styles={{ body: { padding: 0 } }}
          >
            {sidebarContent}
          </Drawer>
        )}

        {/* 右栏 */}
        <main style={{ flex: 1, overflow: 'auto', minHeight: 0, background: 'var(--surface)' }}>
          {!selectedFile ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState icon={<FolderOutlined />} title="选择一个文件" description="从左侧目录树选择一个文件查看" />
            </div>
          ) : contentLoading ? (
            <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}><Skeleton active paragraph={{ rows: 10 }} /></div>
          ) : isMd && mdContent ? (
            <MarkdownViewer
              content={mdContent}
              workspaceServePrefix={servePrefix}
            />
          ) : isHtml && htmlSrc ? (
            <div style={{ height: '100%' }}>
              <HtmlSandbox src={htmlSrc} fill title="分享工作空间文件预览" />
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)' }}>
              该文件类型暂不支持预览
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function findFirstFile(nodes: WorkspaceTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file' && node.path) return node.path
    if (node.children) {
      const found = findFirstFile(node.children)
      if (found) return found
    }
  }
  return null
}
