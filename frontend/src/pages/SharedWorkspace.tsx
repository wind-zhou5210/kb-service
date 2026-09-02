import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Skeleton, message, Drawer, Button } from 'antd'
import { FolderOutlined, LockOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined, DownloadOutlined } from '@ant-design/icons'
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
  // 文件内锚点：进入时从 URL hash（#锚点）捕获，切换文件时清除
  const [fileAnchor, setFileAnchor] = useState(() => {
    const h = window.location.hash
    if (!h) return null
    try { return decodeURIComponent(h.slice(1)) } catch { return h.slice(1) }
  })
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
      // 深链：?file= 命中即选中（hasFile 校验，防非法/失效路径）；否则回退第一个文件。
      // 仅在首次加载时消费（闭包捕获初始 URL），后续地址栏由下方同步 effect 维护
      const fileParam = new URLSearchParams(window.location.search).get('file')
      if (fileParam && hasFile(treeData, fileParam)) {
        setSelectedFile(fileParam)
      } else if (!selectedFile && treeData.length > 0) {
        const first = findFirstFile(treeData)
        if (first) setSelectedFile(first)
      }
    } catch {
      setError(true)
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  // 深链同步：切换文件时更新地址栏 ?file=，随时可从地址栏复制传播"当前文件"链接。
  // 用 replaceState 直改 URL（保留 hash、replace 不污染历史栈），不经 react-router
  // 导航，避免触发组件重加载
  useEffect(() => {
    if (!selectedFile) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('file') === selectedFile) return
    params.set('file', selectedFile)
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
  }, [selectedFile])

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
      // 文件内锚点：拼到 iframe src 的 hash，加载后浏览器原生滚动定位
      setHtmlSrc(`/api/workspaces/share/${token}/serve/${selectedFile}${fileAnchor ? `#${fileAnchor}` : ''}`)
      setMdContent('')
      setContentLoading(false)
    }
  }, [selectedFile, token, fileAnchor])

  // MD 文件内锚点：内容渲染完成后滚动到目标标题（rehype-slug 已为标题生成 id）
  useEffect(() => {
    if (!fileAnchor || !mdContent) return
    if (!selectedFile?.endsWith('.md')) return
    // 渲染/高亮完成后再定位，避免目标元素尚未挂载
    const t = setTimeout(() => {
      document.getElementById(fileAnchor)?.scrollIntoView({ behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(t)
  }, [fileAnchor, mdContent, selectedFile])

  // 清除文件内锚点（state + URL hash），切换文件时调用，避免锚点串到别的文件
  const clearFileAnchor = useCallback(() => {
    setFileAnchor(null)
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [])

  // Auto-refresh when navigate event fires from iframe
  useEffect(() => {
    if (!token) return
    const handler = (e: CustomEvent) => {
      const path = e.detail
      if (typeof path === 'string') {
        const servePrefix = `/api/workspaces/share/${token}/serve/`
        if (path.includes(servePrefix)) {
          let filePath = path.split(servePrefix)[1]
          if (filePath) {
            // iframe 内导航可能带 hash：剥离后由浏览器原生滚动，避免污染文件路径导致树高亮失配
            const hashIdx = filePath.indexOf('#')
            if (hashIdx >= 0) filePath = filePath.slice(0, hashIdx)
            clearFileAnchor()
            setSelectedFile(decodeURIComponent(filePath))
          }
        }
      }
    }
    window.addEventListener('ws-navigate', handler as EventListener)
    return () => window.removeEventListener('ws-navigate', handler as EventListener)
  }, [token, clearFileAnchor])

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
    if (path !== selectedFile) clearFileAnchor()
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
        <div style={{ flex: 1 }} />
        <Button
          size="small"
          icon={<DownloadOutlined />}
          href={`/api/workspaces/share/${token}/download`}
        >
          下载全部
        </Button>
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

// Helper: 目录树中是否存在指定文件路径（深链校验，防非法/失效路径）
function hasFile(nodes: WorkspaceTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return true
    if (node.children && hasFile(node.children, path)) return true
  }
  return false
}
