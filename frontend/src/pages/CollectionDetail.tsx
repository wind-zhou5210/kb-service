import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Spin, Dropdown, Modal, Input, Tag, Space, Skeleton, Tooltip, Select, message } from 'antd'
import {
  ArrowLeftOutlined, UploadOutlined, DeleteOutlined, DownloadOutlined,
  MoreOutlined, SearchOutlined, FileTextOutlined, Html5Outlined, FolderOutlined, EditOutlined,
  FullscreenOutlined, FullscreenExitOutlined, StopOutlined,
} from '@ant-design/icons'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, type Collection, type DocumentItem } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import DocListItem from '../components/DocListItem'
import DocToc, { type TocItem } from '../components/DocToc'
import UploadModal from '../components/UploadModal'
import EmptyState from '../components/EmptyState'
import { formatSize, relativeTime } from '../utils/format'
import { copyToClipboard } from '../utils/clipboard'

const { TextArea } = Input

const TAG_COLORS = ['blue', 'green', 'orange', 'purple', 'cyan', 'magenta', 'gold']

function SortableDoc({ doc, active, onClick, onShare }: {
  doc: DocumentItem
  active: boolean
  onClick: () => void
  onShare: (doc: DocumentItem) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <DocListItem doc={doc} active={active} onClick={onClick} onShare={onShare} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}

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
  const [editing, setEditing] = useState<DocumentItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [editNote, setEditNote] = useState('')
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [shareDocModal, setShareDocModal] = useState<DocumentItem | null>(null)
  const [shareDocUrl, setShareDocUrl] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

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

  const allTags = useMemo(() => {
    const s = new Set<string>()
    docs.forEach(d => d.tags?.split(',').forEach(t => { const v = t.trim(); if (v) s.add(v) }))
    return Array.from(s)
  }, [docs])

  const filteredDocs = useMemo(() => {
    let result = docs
    if (tagFilter) {
      result = result.filter(d => d.tags?.split(',').map(t => t.trim()).includes(tagFilter))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(d => d.title.toLowerCase().includes(q))
    }
    return result
  }, [docs, search, tagFilter])

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

  const openEdit = (doc: DocumentItem) => {
    setEditing(doc)
    setEditTitle(doc.title)
    setEditTags(doc.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? [])
    setEditNote(doc.note ?? '')
  }

  const handleEditSave = async () => {
    if (!editing || !editTitle.trim()) return
    await api.updateDocument(editing.id, {
      title: editTitle.trim(),
      tags: editTags.length > 0 ? editTags.join(',') : null,
      note: editNote.trim() || null,
    })
    setEditing(null); loadDocs()
    if (selected?.id === editing.id) {
      setSelected({ ...selected, title: editTitle.trim(), tags: editTags.join(','), note: editNote.trim() || null })
    }
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = docs.findIndex((d) => d.id === active.id)
    const newIndex = docs.findIndex((d) => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = [...docs]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    setDocs(reordered)
    await Promise.all(
      reordered.map((d, i) => api.updateDocument(d.id, { sort_order: i }))
    )
  }

  const handleDocShare = async (doc: DocumentItem) => {
    const { share_token } = await api.createDocShareLink(doc.id)
    setShareDocUrl(`${window.location.origin}/share/doc/${share_token}`)
    setShareDocModal(doc)
    loadDocs()
  }

  const copyDocShareUrl = async () => {
    const ok = await copyToClipboard(shareDocUrl)
    if (ok) message.success('链接已复制')
    else message.warning('复制失败，请手动选中链接复制')
  }

  const dropdownItems = (doc: DocumentItem) => ({
    items: [
      { key: 'edit', label: '编辑详情', icon: <EditOutlined />, onClick: () => openEdit(doc) },
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => window.open(`/api/documents/${doc.id}/download`) },
      ...(doc.share_token ? [{ key: 'revokeShare', label: '取消分享', icon: <StopOutlined />, onClick: async () => { await api.revokeDocShare(doc.id); message.success('已取消分享'); loadDocs() } }] : []),
      { type: 'divider' as const },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(doc) },
    ],
  })

  const isMd = selected?.ext === '.md'
  const selectedTags = selected?.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? []

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
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Input
              size="small" allowClear
              prefix={<SearchOutlined style={{ color: 'var(--ink-300)', fontSize: 11 }} />}
              placeholder="搜索文件..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {allTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {allTags.map(t => (
                  <Tag
                    key={t}
                    color={tagFilter === t ? 'blue' : 'default'}
                    style={{ cursor: 'pointer', fontSize: 11, margin: 0, borderRadius: 4 }}
                    onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  >
                    {t}
                  </Tag>
                ))}
              </div>
            )}
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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredDocs.map(d => d.id)} strategy={verticalListSortingStrategy}>
                {filteredDocs.map((doc) => (
                  <SortableDoc key={doc.id} doc={doc} active={selected?.id === doc.id} onClick={() => viewDoc(doc)} onShare={handleDocShare} />
                ))}
              </SortableContext>
            </DndContext>
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
                <Space wrap>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
                  <Tag color={isMd ? 'blue' : 'orange'} style={{ borderRadius: 4, fontSize: 11 }}>{selected.ext}</Tag>
                  {selectedTags.map((t, i) => (
                    <Tag key={t} color={TAG_COLORS[i % TAG_COLORS.length]} style={{ borderRadius: 4, fontSize: 11 }}>{t}</Tag>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
                    {formatSize(selected.size)} · {relativeTime(selected.updated_at)}
                  </span>
                </Space>
                <Space>
                  <Tooltip title="全屏阅读">
                    <Button type="text" size="small" icon={<FullscreenOutlined />} onClick={() => setFullscreen(true)} />
                  </Tooltip>
                  <Tooltip title="下载">
                    <Button type="text" size="small" icon={<DownloadOutlined />} onClick={() => window.open(`/api/documents/${selected.id}/download`)} />
                  </Tooltip>
                  <Dropdown menu={dropdownItems(selected)} trigger={['click']}>
                    <Button type="text" size="small" icon={<MoreOutlined />} />
                  </Dropdown>
                </Space>
              </div>

              {selected.note && (
                <div style={{ padding: '8px 32px', background: 'var(--ink-50)', borderBottom: '1px solid var(--ink-100)', fontSize: 12, color: 'var(--ink-500)' }}>
                  📝 {selected.note}
                </div>
              )}

              {contentLoading ? (
                <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}><Skeleton active paragraph={{ rows: 8 }} /></div>
              ) : isMd ? (
                <MarkdownViewer content={mdContent} onTocReady={handleTocReady} />
              ) : (
                <div style={{ padding: 24 }}><HtmlSandbox html={htmlContent} /></div>
              )}
            </div>

            {isMd && tocItems.length > 0 && (
              <aside style={{ width: 208, flexShrink: 0, borderLeft: '1px solid var(--ink-50)' }}>
                <DocToc items={tocItems} />
              </aside>
            )}
          </div>
        )}
      </main>

      {fullscreen && selected && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            flexShrink: 0, height: 48, borderBottom: '1px solid var(--border)',
            padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
            <Button type="text" icon={<FullscreenExitOutlined />} onClick={() => setFullscreen(false)}>退出全屏</Button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {isMd ? (
              <MarkdownViewer content={mdContent} />
            ) : (
              <div style={{ height: '100%', padding: 24 }}><HtmlSandbox html={htmlContent} fill /></div>
            )}
          </div>
        </div>
      )}

      <UploadModal collectionId={colId} open={uploadOpen} onClose={() => setUploadOpen(false)} onSuccess={loadDocs} />
      <Modal title="编辑详情" open={!!editing} onOk={handleEditSave} onCancel={() => setEditing(null)} okText="保存" cancelText="取消" width={460}>
        <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 4 }}>标题</div>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 4 }}>标签</div>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="输入标签后回车"
              value={editTags}
              onChange={setEditTags}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginBottom: 4 }}>备注</div>
            <TextArea value={editNote} rows={3} placeholder="添加备注（可选）" onChange={(e) => setEditNote(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        title="分享文档"
        open={!!shareDocModal}
        onCancel={() => setShareDocModal(null)}
        footer={[
          <Button key="close" onClick={() => setShareDocModal(null)}>关闭</Button>,
          <Button key="copy" type="primary" onClick={copyDocShareUrl}>复制链接</Button>,
        ]}
      >
        <div style={{ paddingTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>
            任何人都可以通过此链接只读查看「{shareDocModal?.title}」（无需登录）。
          </p>
          <Input.Group compact>
            <Input value={shareDocUrl} readOnly style={{ width: 'calc(100% - 80px)' }} />
            <Button type="primary" onClick={copyDocShareUrl} style={{ width: 80 }}>复制</Button>
          </Input.Group>
        </div>
      </Modal>
    </div>
  )
}
