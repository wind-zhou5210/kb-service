import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Spin, Dropdown, Modal, Input, Tag, Space, Skeleton, Tooltip } from 'antd'
import {
  ArrowLeftOutlined, UploadOutlined, DeleteOutlined, DownloadOutlined,
  MoreOutlined, SearchOutlined, FileTextOutlined, Html5Outlined, FolderOutlined,
} from '@ant-design/icons'
import { api, type Collection, type DocumentItem } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import DocListItem from '../components/DocListItem'
import DocToc, { type TocItem } from '../components/DocToc'
import UploadModal from '../components/UploadModal'
import EmptyState from '../components/EmptyState'
import { formatSize, relativeTime } from '../utils/format'

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>()
  const colId = Number(id)
  const navigate = useNavigate()

  const [collection, setCollection] = useState<Collection | null>(null)
  const [docs, setDocs] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DocumentItem | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [renaming, setRenaming] = useState<DocumentItem | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [search, setSearch] = useState('')

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listDocuments(colId)
      setDocs(list)
      const cols = await api.listCollections()
      setCollection(cols.find((c) => c.id === colId) ?? null)
    } finally { setLoading(false) }
  }, [colId])

  useEffect(() => { loadDocs() }, [loadDocs])

  const viewDoc = useCallback(async (doc: DocumentItem) => {
    setSelected(doc); setTocItems([]); setContentLoading(true)
    try {
      if (doc.ext === '.md') {
        setMdContent(await api.getRaw(doc.id)); setHtmlContent('')
      } else {
        setHtmlContent(await api.getRaw(doc.id, 'html')); setMdContent('')
      }
    } finally { setContentLoading(false) }
  }, [])

  const handleTocReady = useCallback((items: TocItem[]) => setTocItems(items), [])

  const filteredDocs = useMemo(() => {
    if (!search.trim()) return docs
    const q = search.toLowerCase()
    return docs.filter((d) => d.title.toLowerCase().includes(q))
  }, [docs, search])

  const handleDelete = (doc: DocumentItem) => {
    Modal.confirm({
      title: '删除文件', content: `确认删除「${doc.filename}」？`,
      okType: 'danger', okText: '删除', cancelText: '取消',
      onOk: async () => {
        await api.deleteDocument(doc.id)
        if (selected?.id === doc.id) { setSelected(null); setMdContent(''); setHtmlContent('') }
        loadDocs()
      },
    })
  }

  const handleRename = async () => {
    if (!renaming || !renameTitle.trim()) return
    await api.updateDocument(renaming.id, { title: renameTitle.trim() })
    setRenaming(null); loadDocs()
    if (selected?.id === renaming.id) setSelected({ ...selected, title: renameTitle.trim() })
  }

  const dropdownItems = (doc: DocumentItem) => ({
    items: [
      { key: 'rename', label: '重命名', onClick: () => { setRenaming(doc); setRenameTitle(doc.title) } },
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => window.open(`/api/documents/${doc.id}/download`) },
      { type: 'divider' as const },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(doc) },
    ],
  })

  const isMd = selected?.ext === '.md'

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>
      {/* 左栏 */}
      <aside style={{ width: 256, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: 14, borderBottom: '1px solid var(--ink-50)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} size="small" />
            <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>返回</span>
          </div>
          {collection && (
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <div style={{
                width: 30, height: 30, borderRadius: 6, background: 'var(--ink-50)',
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
                  {docs.length} files
                </div>
              </div>
            </div>
          )}
          <Button type="primary" icon={<UploadOutlined />} block onClick={() => setUploadOpen(true)} style={{ marginTop: 10 }}>
            上传文件
          </Button>
        </div>

        {docs.length > 0 && (
          <div style={{ padding: '8px 10px' }}>
            <Input
              size="small" allowClear
              prefix={<SearchOutlined style={{ color: 'var(--ink-300)', fontSize: 11 }} />}
              placeholder="搜索文件..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
          {loading ? (
            <div style={{ padding: 12 }}>{[1,2,3,4].map((i) => <Skeleton key={i} active paragraph={{ rows: 1 }} title={{ width: '60%' }} style={{ marginBottom: 10 }} />)}</div>
          ) : docs.length === 0 ? (
            <div style={{ padding: 20 }}>
              <EmptyState icon={<FileTextOutlined />} title="暂无文件" description="上传第一份文档" actionText="上传文件" onAction={() => setUploadOpen(true)} />
            </div>
          ) : filteredDocs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12 }}>未找到匹配文件</div>
          ) : (
            filteredDocs.map((doc) => (
              <DocListItem key={doc.id} doc={doc} active={selected?.id === doc.id} onClick={() => viewDoc(doc)} />
            ))
          )}
        </div>
      </aside>

      {/* 内容区 */}
      <main style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
        {!selected ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState icon={<FileTextOutlined />} title="选择文件开始阅读" description="从左侧列表选择一份文档" />
          </div>
        ) : (
          <div style={{ minHeight: '100%', display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 文档顶栏 */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)',
                borderBottom: '1px solid var(--ink-50)', padding: '10px 32px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Space>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
                  <Tag color={isMd ? 'blue' : 'orange'} style={{ borderRadius: 4, fontSize: 11 }}>{selected.ext}</Tag>
                  <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
                    {formatSize(selected.size)} · {relativeTime(selected.created_at)}
                  </span>
                </Space>
                <Space>
                  <Tooltip title="下载">
                    <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => window.open(`/api/documents/${selected.id}/download`)} />
                  </Tooltip>
                  <Dropdown menu={dropdownItems(selected)} trigger={['click']}>
                    <Button type="text" size="small" icon={<MoreOutlined />} />
                  </Dropdown>
                </Space>
              </div>

              {contentLoading ? (
                <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}><Skeleton active paragraph={{ rows: 8 }} /></div>
              ) : isMd ? (
                <MarkdownViewer content={mdContent} onTocReady={handleTocReady} />
              ) : (
                <div style={{ padding: 24 }}><HtmlSandbox html={htmlContent} /></div>
              )}
            </div>

            {isMd && tocItems.length > 0 && (
              <aside style={{ width: 208, flexShrink: 0, borderLeft: '1px solid var(--ink-50)', overflow: 'auto' }}>
                <DocToc items={tocItems} />
              </aside>
            )}
          </div>
        )}
      </main>

      <UploadModal collectionId={colId} open={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={loadDocs} />
      <Modal title="重命名" open={!!renaming} onOk={handleRename} onCancel={() => setRenaming(null)} okText="确认" cancelText="取消">
        <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} />
      </Modal>
    </div>
  )
}
