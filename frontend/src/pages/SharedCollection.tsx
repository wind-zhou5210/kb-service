import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Tag, Space, Button, Drawer, Empty } from 'antd'
import { FileTextOutlined, Html5Outlined, FolderOutlined, MenuOutlined } from '@ant-design/icons'
import { api, type Collection, type DocumentItem } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import { formatSize, relativeTime } from '../utils/format'
import { useIsMobile } from '../hooks/useMediaQuery'

export default function SharedCollection() {
  const { token } = useParams<{ token: string }>()
  const [collection, setCollection] = useState<Collection | null>(null)
  const [docs, setDocs] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<DocumentItem | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  // P2-6：移动端文件列表改 Drawer 呈现
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await api.getSharedCollection(token)
      setCollection(data.collection)
      setDocs(data.documents)
      if (data.documents.length > 0) {
        setSelected(data.documents[0])
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const viewDoc = useCallback(async (doc: DocumentItem) => {
    setSelected(doc); setContentLoading(true)
    try {
      if (doc.ext === '.md') {
        setMdContent(await api.getRaw(doc.id)); setHtmlContent('')
      } else {
        setHtmlContent(await api.getRaw(doc.id, 'html')); setMdContent('')
      }
    } finally { setContentLoading(false) }
  }, [])

  useEffect(() => {
    if (selected) viewDoc(selected)
  }, [selected, viewDoc])

  const handleSelectDoc = (doc: DocumentItem) => {
    setSelected(doc)
    if (isMobile) setDrawerOpen(false)
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin /></div>
  }

  if (error || !collection) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 12 }}>
        <Empty description="分享链接无效或已失效" />
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const isMd = selected?.ext === '.md'

  const sidebarContent = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 14, borderBottom: '1px solid var(--subtle-border)' }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 6, background: 'var(--subtle-bg)',
            border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--ink-500)', fontSize: 14,
          }}>
            <FolderOutlined />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {collection.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginTop: 1 }}>
              {docs.length} 个文件 · 只读分享
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        {docs.map((doc) => (
          <div
            key={doc.id}
            className={`doc-item ${selected?.id === doc.id ? 'active' : ''}`}
            onClick={() => handleSelectDoc(doc)}
          >
            <span className="doc-icon" style={{ color: doc.ext === '.md' ? 'var(--md-color)' : 'var(--html-color)' }}>
              {doc.ext === '.md' ? <FileTextOutlined /> : <Html5Outlined />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="doc-name">{doc.title}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>
                {formatSize(doc.size)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* 顶栏：移动端打开文件列表 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        {isMobile ? (
          <Button type="text" size="small" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开文件列表">文件列表</Button>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-900)' }}>{collection.name}</span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--ink-300)', fontFamily: 'var(--mono)', flexShrink: 0 }}>只读分享</span>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 桌面端左栏 */}
        {!isMobile && (
          <aside style={{ width: 256, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {sidebarContent}
          </aside>
        )}

        {/* 移动端：文件列表 Drawer */}
        {isMobile && (
          <Drawer
            title="文件列表"
            placement="left"
            width="min(320px, 85vw)"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            styles={{ body: { padding: 0 } }}
          >
            {sidebarContent}
          </Drawer>
        )}

        {/* 内容区 */}
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
          {!selected ? (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="暂无文档" />
            </div>
          ) : (
            <div style={{ minHeight: '100%', display: 'flex' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)',
                  borderBottom: '1px solid var(--subtle-border)', padding: '10px 32px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <Space>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
                    <Tag color={isMd ? 'var(--md-color)' : 'var(--html-color)'} style={{ borderRadius: 4, fontSize: 11 }}>{selected.ext}</Tag>
                    <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
                      {formatSize(selected.size)} · {relativeTime(selected.created_at)}
                    </span>
                  </Space>
                </div>

                {contentLoading ? (
                  <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}><Spin /></div>
                ) : isMd ? (
                  <MarkdownViewer content={mdContent} onTocReady={() => {}} />
                ) : (
                  <div style={{ padding: 24 }}><HtmlSandbox html={htmlContent} title="分享文档内容预览" /></div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
