import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Spin, Modal, Input, Skeleton, Space, Tag, message, Upload, Typography } from 'antd'
import { UploadOutlined, ArrowLeftOutlined, ShareAltOutlined, FolderOutlined, DeleteOutlined, InboxOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { api, type Workspace, type WorkspaceTreeNode } from '../api/client'
import { formatSize, relativeTime } from '../utils/format'
import WorkspaceTree from '../components/WorkspaceTree'
import HtmlSandbox from '../components/HtmlSandbox'
import MarkdownViewer from '../components/MarkdownViewer'
import EmptyState from '../components/EmptyState'
import { copyToClipboard } from '../utils/clipboard'

const { Dragger } = Upload
const { TextArea } = Input

const SIDEBAR_COLLAPSED_KEY = 'kb_ws_sidebar_collapsed'

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>()
  const wsId = Number(id)
  const navigate = useNavigate()

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tree, setTree] = useState<WorkspaceTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [htmlSrc, setHtmlSrc] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  // 侧栏收起状态：持久化到 localStorage，刷新后保持
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')

  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, c ? '0' : '1')
      return !c
    })
  }

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      const [ws, treeData] = await Promise.all([
        api.getWorkspace(wsId),
        api.getWorkspaceTree(wsId),
      ])
      setWorkspace(ws)
      setTree(treeData)
      setShareToken(ws.share_token)
      // Auto-select first file if exists
      if (!selectedFile && treeData.length > 0) {
        const first = findFirstFile(treeData)
        if (first) setSelectedFile(first)
      }
    } finally { setLoading(false) }
  }, [wsId])

  useEffect(() => { loadWorkspace() }, [loadWorkspace])

  // Auto-refresh when navigate event fires from iframe
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const path = e.detail
      if (typeof path === 'string') {
        // Extract relative path from the iframe's URL
        const servePrefix = `/api/workspaces/${wsId}/serve/`
        if (path.includes(servePrefix)) {
          const filePath = path.split(servePrefix)[1]
          if (filePath) setSelectedFile(decodeURIComponent(filePath))
        }
      }
    }
    window.addEventListener('ws-navigate', handler as EventListener)
    return () => window.removeEventListener('ws-navigate', handler as EventListener)
  }, [wsId])

  // Load file content when selectedFile changes
  useEffect(() => {
    if (!selectedFile) { setMdContent(''); setHtmlSrc(''); return }
    const isMd = selectedFile.endsWith('.md')
    const isHtml = selectedFile.endsWith('.html') || selectedFile.endsWith('.htm')
    if (!isMd && !isHtml) { setMdContent(''); setHtmlSrc(''); return }

    setContentLoading(true)
    const token = localStorage.getItem('kb_token') || ''

    if (isMd) {
      // Fetch MD content with image rewriting
      fetch(`/api/workspaces/${wsId}/serve/${selectedFile}?render=md`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.text())
        .then(text => { setMdContent(text); setHtmlSrc('') })
        .finally(() => setContentLoading(false))
    } else {
      // HTML: set iframe src with JWT
      setHtmlSrc(`/api/workspaces/${wsId}/serve/${selectedFile}?jwt=${encodeURIComponent(token)}`)
      setMdContent('')
      setContentLoading(false)
    }
  }, [selectedFile, wsId])

  const handleInternalLink = (path: string) => {
    setSelectedFile(path)
  }

  // Upload
  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      await api.uploadWorkspaceZip(wsId, file)
      message.success('上传成功')
      setUploadOpen(false)
      loadWorkspace()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '上传失败')
    } finally { setUploading(false) }
  }

  // Share
  const handleShare = async () => {
    try {
      const { share_token } = await api.createWorkspaceShare(wsId)
      setShareToken(share_token)
      setShareUrl(`${window.location.origin}/share/workspace/${share_token}`)
      setShareModalOpen(true)
    } catch { message.error('生成分享链接失败') }
  }

  const copyShareUrl = async () => {
    const ok = await copyToClipboard(shareUrl)
    if (ok) message.success('链接已复制')
    else message.warning('复制失败')
  }

  const revokeShare = async () => {
    try {
      await api.revokeWorkspaceShare(wsId)
      setShareToken(null)
      message.success('已取消分享')
    } catch { message.error('取消失败') }
  }

  // Delete
  const handleDelete = () => {
    Modal.confirm({
      title: '删除工作空间',
      content: `确认删除「${workspace?.name}」？此操作不可撤销，磁盘文件将被一并删除。`,
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        await api.deleteWorkspace(wsId)
        message.success('已删除')
        navigate('/workspaces')
      },
    })
  }

  if (loading) {
    return <div style={{ padding: 32 }}><Skeleton active paragraph={{ rows: 12 }} /></div>
  }

  if (!workspace) {
    return (
      <div style={{ padding: 40 }}>
        <EmptyState icon={<FolderOutlined />} title="工作空间不存在" description="找不到该工作空间" actionText="返回列表" onAction={() => navigate('/workspaces')} />
      </div>
    )
  }

  const isMd = selectedFile?.endsWith('.md') ?? false
  const isHtml = selectedFile?.endsWith('.html') ?? selectedFile?.endsWith('.htm') ?? false
  const servePrefix = `/api/workspaces/${wsId}/serve/`

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden', position: 'relative' }}>
      {/* 左栏：目录树（可收起，宽度过渡动画） */}
      <aside style={{ width: collapsed ? 0 : 280, borderRight: collapsed ? 'none' : '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, overflow: 'hidden', transition: 'width 0.2s var(--ease)' }}>
        <div style={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--subtle-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/workspaces')} size="small" />
            <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>返回</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)', marginBottom: 4 }}>{workspace.name}</div>
          {workspace.description && (
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 4 }}>{workspace.description}</div>
          )}
          <div style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginBottom: 10 }}>
            {workspace.doc_count} 个文件 · {formatSize(workspace.total_size)}
          </div>
          <Space>
            <Button type="primary" size="small" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传</Button>
            <Button size="small" icon={<ShareAltOutlined />} onClick={handleShare}>
              {shareToken ? '分享' : '分享'}
            </Button>
            <Button size="small" icon={<DeleteOutlined />} onClick={handleDelete} danger />
          </Space>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 4px' }}>
          <WorkspaceTree treeData={tree} selectedFile={selectedFile || undefined} onSelect={setSelectedFile} />
        </div>
        </div>
      </aside>

      {/* 侧栏收起/展开按钮：悬浮于分界处，随侧栏平滑移动 */}
      <Button
        type="text"
        size="small"
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={toggleSidebar}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
        style={{
          position: 'absolute', top: 8, left: collapsed ? 8 : 288, zIndex: 20,
          background: 'var(--surface)', border: '1px solid var(--border)',
          transition: 'left 0.2s var(--ease)',
        }}
      />

      {/* 右栏：内容区 */}
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
            onInternalLink={handleInternalLink}
            workspaceServePrefix={servePrefix}
          />
        ) : isHtml && htmlSrc ? (
          <div style={{ height: '100%' }}>
            <HtmlSandbox src={htmlSrc} fill />
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-400)' }}>
            该文件类型暂不支持预览
          </div>
        )}
      </main>

      {/* 上传弹窗 */}
      <Modal title="上传工作空间" open={uploadOpen} onCancel={() => setUploadOpen(false)} footer={null}>
        <Dragger
          accept=".zip"
          multiple={false}
          beforeUpload={(file) => {
            handleUpload(file)
            return Upload.LIST_IGNORE
          }}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined style={{ fontSize: 40, color: 'var(--accent)' }} /></p>
          <p style={{ fontSize: 14, fontWeight: 500 }}>点击或拖拽 .zip 文件</p>
          <p style={{ fontSize: 12, color: 'var(--ink-400)' }}>将包含所有文件及目录结构的 zip 包上传</p>
        </Dragger>
      </Modal>

      {/* 分享弹窗 */}
      <Modal title="分享工作空间" open={shareModalOpen} onCancel={() => setShareModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setShareModalOpen(false)}>关闭</Button>,
          shareToken && <Button key="copy" type="primary" onClick={copyShareUrl}>复制链接</Button>,
          shareToken && <Button key="revoke" danger onClick={() => { revokeShare(); setShareModalOpen(false) }}>取消分享</Button>,
        ]}
      >
        {shareToken ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>
              任何人都可以通过此链接查看该工作空间（无需登录）。
            </p>
            <Input.Search value={shareUrl} readOnly enterButton="复制" onSearch={copyShareUrl} />
          </>
        ) : (
          <p>正在生成分享链接...</p>
        )}
      </Modal>
    </div>
  )
}

// Helper: find first file in tree recursively
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
