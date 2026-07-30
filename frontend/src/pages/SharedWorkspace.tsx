import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Skeleton, message } from 'antd'
import { FolderOutlined, LockOutlined } from '@ant-design/icons'
import { api, type Workspace, type WorkspaceTreeNode } from '../api/client'
import { formatSize } from '../utils/format'
import WorkspaceTree from '../components/WorkspaceTree'
import HtmlSandbox from '../components/HtmlSandbox'
import MarkdownViewer from '../components/MarkdownViewer'
import EmptyState from '../components/EmptyState'

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
        <Link to="/login">返回登录</Link>
      </div>
    )
  }

  const servePrefix = `/api/workspaces/share/${token}/serve/`
  const isMd = selectedFile?.endsWith('.md') ?? false
  const isHtml = selectedFile?.endsWith('.html') ?? selectedFile?.endsWith('.htm') ?? false

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左栏 */}
      <aside style={{ width: 280, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
          <WorkspaceTree treeData={tree} selectedFile={selectedFile || undefined} onSelect={setSelectedFile} />
        </div>
      </aside>

      {/* 右栏 */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
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
          <HtmlSandbox src={htmlSrc} />
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)' }}>
            该文件类型暂不支持预览
          </div>
        )}
      </main>
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
