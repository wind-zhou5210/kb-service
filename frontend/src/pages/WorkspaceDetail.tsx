import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Modal, Input, Skeleton, Space, message, Upload, Drawer, Tooltip, Dropdown } from 'antd'
import { UploadOutlined, DownloadOutlined, ShareAltOutlined, FolderOutlined, DeleteOutlined, InboxOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MenuOutlined, FileAddOutlined, MoreOutlined } from '@ant-design/icons'
import { api, type Workspace, type WorkspaceTreeNode } from '../api/client'
import { formatSize, relativeTime } from '../utils/format'
import { trackRecent, updateRecentScroll, getRecent } from '../utils/recent'
import WorkspaceTree from '../components/WorkspaceTree'
import HtmlSandbox from '../components/HtmlSandbox'
import MarkdownViewer from '../components/MarkdownViewer'
import EmptyState from '../components/EmptyState'
import SubNav from '../components/SubNav'
import { copyToClipboard } from '../utils/clipboard'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useWorkspaceStore } from '../store/workspace'

const { Dragger } = Upload
const { TextArea } = Input

const SIDEBAR_COLLAPSED_KEY = 'kb_ws_sidebar_collapsed'

export default function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>()
  const wsId = Number(id)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

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
  // 添加单个文件：弹窗状态
  const [addFileOpen, setAddFileOpen] = useState(false)
  const [addFilePath, setAddFilePath] = useState('')
  const [addFile, setAddFile] = useState<File | null>(null)
  const [addFileUploading, setAddFileUploading] = useState(false)
  // 替换文件：隐藏 input 与目标路径
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replacePathRef = useRef<string | null>(null)
  // 预览强制重载版本号：递增后触发同路径内容重新加载
  const [viewerVersion, setViewerVersion] = useState(0)
  // 同步跟踪最新 selectedFile，供异步回调里安全判断（避免闭包旧快照竞态）
  const selectedFileRef = useRef<string | null>(null)
  // 侧栏收起状态：持久化到 localStorage，刷新后保持（仅桌面端）
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
  // 移动端：目录树改为 Drawer 呈现
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 面包屑：上报当前工作空间
  const setCurrent = useWorkspaceStore((s) => s.setCurrent)

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
      setCurrent(ws)
      setTree(treeData)
      setShareToken(ws.share_token)
      // 深链：?file= 命中即选中并消费（清理参数，避免后续 reload 拽回）；否则仅首次加载自动选第一个
      const fileParam = searchParams.get('file')
      if (fileParam && hasFile(treeData, fileParam)) {
        setSearchParams({}, { replace: true })
        setSelectedFile(fileParam)
      } else if (!selectedFileRef.current && treeData.length > 0) {
        const first = findFirstFile(treeData)
        if (first) setSelectedFile(first)
      }
    } finally { setLoading(false) }
  }, [wsId, searchParams])

  useEffect(() => { loadWorkspace() }, [loadWorkspace])

  // 卸载时清空面包屑的当前空间
  useEffect(() => () => setCurrent(null), [setCurrent])

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

  // Load file content when selectedFile changes（viewerVersion 变化时同路径强制重载）
  useEffect(() => {
    selectedFileRef.current = selectedFile
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
      // HTML: set iframe src with JWT（附 v 参数，替换后同路径也能重新加载 iframe）
      setHtmlSrc(`/api/workspaces/${wsId}/serve/${selectedFile}?jwt=${encodeURIComponent(token)}&v=${viewerVersion}`)
      setMdContent('')
      setContentLoading(false)
    }
  }, [selectedFile, wsId, viewerVersion])

  // 最近阅读埋点：工作空间文件
  useEffect(() => {
    if (!selectedFile || !workspace) return
    const base = selectedFile.split('/').pop() || selectedFile
    const dot = base.lastIndexOf('.')
    trackRecent({
      id: selectedFile,
      kind: 'workspace',
      title: base,
      ext: dot > 0 ? base.slice(dot) : null,
      sourceId: workspace.id,
      sourceName: workspace.name,
    })
  }, [selectedFile, workspace])

  // 阅读体验：进度条 + 切换文件回到顶部 + 滚动位置记忆
  const mainRef = useRef<HTMLElement>(null)
  const [readProgress, setReadProgress] = useState(0)
  const scrollRatioRef = useRef(0)
  const updateProgress = useCallback(() => {
    const el = mainRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    setReadProgress(max <= 0 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100)))
    scrollRatioRef.current = max <= 0 ? 0 : Math.min(1, el.scrollTop / max)
  }, [])
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTo({ top: 0 })
  }, [selectedFile])
  useEffect(() => { updateProgress() }, [mdContent, htmlSrc, updateProgress])
  // P1-5：离开文件时记录滚动比例
  useEffect(() => {
    const prev = selectedFile
    return () => {
      if (prev) updateRecentScroll('workspace', prev, scrollRatioRef.current)
    }
  }, [selectedFile])
  // P1-5：继续阅读 —— 内容加载后恢复位置
  useEffect(() => {
    if (!selectedFile || contentLoading) return
    const rec = getRecent().find((r) => r.kind === 'workspace' && r.id === selectedFile)
    if (rec?.scrollRatio && mainRef.current) {
      const el = mainRef.current
      const top = rec.scrollRatio * (el.scrollHeight - el.clientHeight)
      if (top > 0) el.scrollTo({ top })
    }
  }, [selectedFile, mdContent, htmlSrc, contentLoading])

  const handleInternalLink = (path: string) => {
    setSelectedFile(path)
  }

  // 目录树选中：移动端选中后自动关闭 Drawer
  const handleSelectFile = (path: string) => {
    setSelectedFile(path)
    if (isMobile) setDrawerOpen(false)
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

  // 替换文件：右键菜单触发，记下目标路径后唤起文件选择
  const handleReplaceFile = (path: string) => {
    replacePathRef.current = path
    replaceInputRef.current?.click()
  }

  const handleReplaceInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许下次选择同一文件
    const path = replacePathRef.current
    if (!file || !path) return
    try {
      await api.uploadWorkspaceFile(wsId, path, file)
      message.success('替换成功')
      loadWorkspace()
      // 若替换的是当前预览文件，递增版本号强制重新加载内容
      // 用 ref 读最新选中路径，避免上传期间用户已切换文件时被闭包旧快照误覆盖
      if (selectedFileRef.current === path) {
        setViewerVersion(v => v + 1)
      }
    } catch (err: any) {
      message.error(err.response?.data?.detail || '替换失败')
    }
  }

  // 删除单个文件
  const handleDeleteFile = (path: string) => {
    Modal.confirm({
      title: '删除文件',
      content: `确认删除「${path}」？此操作不可撤销。`,
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        try {
          await api.deleteWorkspaceFile(wsId, path)
          message.success('已删除')
          if (selectedFile === path) setSelectedFile(null)
          loadWorkspace()
        } catch (err: any) {
          message.error(err.response?.data?.detail || '删除失败')
        }
      },
    })
  }

  // 添加单个文件
  const handleAddFile = async () => {
    const path = addFilePath.trim()
    if (!path || !addFile) { message.warning('请填写目标路径并选择文件'); return }
    setAddFileUploading(true)
    try {
      await api.uploadWorkspaceFile(wsId, path, addFile)
      message.success('添加成功')
      setAddFileOpen(false)
      setAddFilePath('')
      setAddFile(null)
      loadWorkspace()
    } catch (err: any) {
      message.error(err.response?.data?.detail || '添加失败')
    } finally { setAddFileUploading(false) }
  }

  // Download：<a> 触发浏览器原生下载（进度/取消由浏览器接管，不占页面内存）
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = api.workspaceDownloadUrl(wsId)
    document.body.appendChild(a)
    a.click()
    a.remove()
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

  // P0-1：取消分享是高风险不可逆操作，必须先确认（与集合/文档分享行为一致）
  const revokeShare = () => {
    Modal.confirm({
      title: '取消分享',
      content: '取消后，已分享的链接将立即失效，所有访问者将无法再查看该工作空间。确认取消？',
      okType: 'danger',
      okText: '取消分享',
      cancelText: '保留',
      onOk: async () => {
        try {
          await api.revokeWorkspaceShare(wsId)
          setShareToken(null)
          message.success('已取消分享')
          setShareModalOpen(false)
        } catch { message.error('取消失败') }
      },
    })
  }

  // Delete
  const handleDelete = () => {
    Modal.confirm({
      title: '删除工作空间',
      content: `确认删除「${workspace?.name}」？此操作不可撤销，磁盘文件将被一并删除，删除后分享链接将失效。`,
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
    return <div style={{ padding: 'var(--space-8)' }}><Skeleton active paragraph={{ rows: 12 }} /></div>
  }

  if (!workspace) {
    return (
      <div style={{ padding: 'var(--space-12)' }}>
        <EmptyState icon={<FolderOutlined />} title="工作空间不存在" description="找不到该工作空间" actionText="返回列表" onAction={() => navigate('/workspaces')} />
      </div>
    )
  }

  const isMd = selectedFile?.endsWith('.md') ?? false
  const isHtml = selectedFile?.endsWith('.html') ?? selectedFile?.endsWith('.htm') ?? false
  const servePrefix = `/api/workspaces/${wsId}/serve/`

  // 侧栏内容：桌面端放 aside，移动端放 Drawer
  const sidebarContent = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--subtle-border)' }}>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-900)' }}>{workspace.name}</div>
        {workspace.description && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-500)', marginTop: 'var(--space-2)' }}>{workspace.description}</div>
        )}
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginTop: 'var(--space-2)' }}>
          {workspace.file_count} 个文件 · {formatSize(workspace.total_size)}
        </div>
        {/* P1-4：主按钮 + 更多下拉 + 删除分隔（避免 5 连图标簇） */}
        <Space style={{ marginTop: 'var(--space-3)' }} size={4}>
          <Button type="primary" size="small" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>上传</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'download', label: '下载', icon: <DownloadOutlined />, disabled: !workspace.file_count, onClick: handleDownload },
                { key: 'share', label: '分享', icon: <ShareAltOutlined />, onClick: handleShare },
                { key: 'addfile', label: '添加文件', icon: <FileAddOutlined />, onClick: () => { setAddFilePath(''); setAddFile(null); setAddFileOpen(true) } },
              ],
            }}
            trigger={['click']}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label="更多操作" />
          </Dropdown>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <Tooltip title="删除工作空间">
            <Button size="small" icon={<DeleteOutlined />} onClick={handleDelete} danger aria-label="删除工作空间" />
          </Tooltip>
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-2) var(--space-1)' }}>
        <WorkspaceTree treeData={tree} selectedFile={selectedFile || undefined} onSelect={handleSelectFile} onReplaceFile={handleReplaceFile} onDeleteFile={handleDeleteFile} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 二级导航栏：面包屑 + 页面级操作 */}
      <SubNav
        actions={isMobile ? (
          <Button type="text" size="small" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开目录">目录</Button>
        ) : (
          <Button
            type="text"
            size="small"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={toggleSidebar}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          />
        )}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 桌面端左栏：目录树（可收起） */}
      {!isMobile && (
        <aside style={{ width: collapsed ? 0 : 'var(--sidebar-w)', borderRight: collapsed ? 'none' : '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ width: 'var(--sidebar-w)', height: '100%', transition: 'opacity 0.18s var(--ease)', opacity: collapsed ? 0 : 1 }}>
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

      {/* 右栏：内容区 */}
      <main ref={mainRef} onScroll={updateProgress} style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
        {/* 阅读进度条：仅 markdown（html iframe 内部自滚，不遮挡）；scaleX 避免布局抖动 */}
        {isMd && mdContent && (
          <div style={{ position: 'sticky', top: 0, zIndex: 20, height: 2, background: 'var(--border)' }}>
            <div style={{ transform: `scaleX(${readProgress / 100})`, transformOrigin: 'left center', height: '100%', background: 'var(--accent)', transition: 'transform 0.12s linear' }} />
          </div>
        )}
        {!selectedFile ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState icon={<FolderOutlined />} title="选择一个文件" description="从左侧目录树选择一个文件查看" />
          </div>
        ) : contentLoading ? (
          <div style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto' }}><Skeleton active paragraph={{ rows: 10 }} /></div>
        ) : isMd && mdContent ? (
          <MarkdownViewer
            content={mdContent}
            onInternalLink={handleInternalLink}
            workspaceServePrefix={servePrefix}
          />
        ) : isHtml && htmlSrc ? (
          <div style={{ height: '100%' }}>
            <HtmlSandbox src={htmlSrc} fill title="工作空间文件预览" />
          </div>
        ) : (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--ink-400)' }}>
            该文件类型暂不支持预览
          </div>
        )}
      </main>
      </div>

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
        <p style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 12, marginBottom: 0 }}>
          更新工作空间内容不会影响已生成的分享链接。
        </p>
      </Modal>

      {/* 添加文件弹窗 */}
      <Modal title="添加文件" open={addFileOpen} onCancel={() => setAddFileOpen(false)}
        onOk={handleAddFile} okText="添加" confirmLoading={addFileUploading}
      >
        <Input
          placeholder="目标路径，如 docs/guide.md"
          value={addFilePath}
          onChange={(e) => setAddFilePath(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <Dragger
          multiple={false}
          beforeUpload={(file) => {
            setAddFile(file)
            // 路径为空时自动填入文件名
            setAddFilePath((prev) => prev.trim() ? prev : file.name)
            return Upload.LIST_IGNORE
          }}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined style={{ fontSize: 40, color: 'var(--accent)' }} /></p>
          <p style={{ fontSize: 14, fontWeight: 500 }}>{addFile ? `已选择：${addFile.name}` : '点击或拖拽选择文件'}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-400)' }}>单个文件上传至目标路径，已存在时将被替换</p>
        </Dragger>
      </Modal>

      {/* 分享弹窗 */}
      <Modal title="分享工作空间" open={shareModalOpen} onCancel={() => setShareModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setShareModalOpen(false)}>关闭</Button>,
          shareToken && <Button key="copy" type="primary" onClick={copyShareUrl}>复制链接</Button>,
          shareToken && <Button key="revoke" danger onClick={revokeShare}>取消分享</Button>,
        ]}
      >
        {shareToken ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>
              任何获得此链接的人都可以只读查看该工作空间（无需登录）。请勿在公开场合泄露链接。
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-400)', marginBottom: 12 }}>
              取消分享后链接将立即失效；更新内容不会影响已生成的链接。
            </p>
            <Input.Search value={shareUrl} readOnly enterButton="复制" onSearch={copyShareUrl} />
          </>
        ) : (
          <p>正在生成分享链接...</p>
        )}
      </Modal>

      {/* 替换文件：隐藏文件选择器 */}
      <input type="file" ref={replaceInputRef} style={{ display: 'none' }} onChange={handleReplaceInputChange} />
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

// Helper: 目录树中是否存在指定文件路径（深链校验）
function hasFile(nodes: WorkspaceTreeNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === path) return true
    if (node.children && hasFile(node.children, path)) return true
  }
  return false
}
