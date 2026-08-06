import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button, Spin, Dropdown, Modal, Input, Tag, Space, Skeleton, Tooltip, Select, message, Row, Col, Drawer } from 'antd'
import {
  UploadOutlined, DeleteOutlined, DownloadOutlined,
  MoreOutlined, SearchOutlined, FileTextOutlined, Html5Outlined, FolderOutlined, EditOutlined,
  FullscreenOutlined, FullscreenExitOutlined, StopOutlined, SwapOutlined, HistoryOutlined, MenuOutlined,
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
import VersionHistoryModal from '../components/VersionHistoryModal'
import EmptyState from '../components/EmptyState'
import SubNav from '../components/SubNav'
import { formatSize, relativeTime } from '../utils/format'
import { copyToClipboard } from '../utils/clipboard'
import { trackRecent, updateRecentScroll, getRecent } from '../utils/recent'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useCollectionStore } from '../store/collection'

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
  const [searchParams, setSearchParams] = useSearchParams()

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
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<DocumentItem | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [versionHistoryDoc, setVersionHistoryDoc] = useState<DocumentItem | null>(null)
  // 移动端：文件列表改为 Drawer 呈现
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 面包屑：上报当前集合
  const setCurrent = useCollectionStore((s) => s.setCurrent)
  // 最近阅读埋点：持最新 collection 引用，避免 viewDoc 闭包旧快照
  const collectionRef = useRef<Collection | null>(null)

  // P2-5：文档排序防抖批量保存
  const docSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // M-1：卸载时清掉未触发的防抖 timer
  useEffect(() => () => { if (docSaveTimerRef.current) clearTimeout(docSaveTimerRef.current) }, [])

  // 阅读体验：进度条 + 切换文档回到顶部 + 滚动位置记忆
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
  }, [selected])
  useEffect(() => { updateProgress() }, [mdContent, htmlContent, updateProgress])
  // P1-5：离开文档时记录滚动比例（供「继续阅读」恢复）
  useEffect(() => {
    const prev = selected
    return () => {
      const col = collectionRef.current
      if (prev && col) updateRecentScroll('collection', prev.id, scrollRatioRef.current)
    }
  }, [selected])
  // P1-5：继续阅读 —— 内容加载后恢复到上次位置
  useEffect(() => {
    if (!selected || contentLoading) return
    const rec = getRecent().find((r) => r.kind === 'collection' && r.id === selected.id)
    if (rec?.scrollRatio && mainRef.current) {
      const el = mainRef.current
      const top = rec.scrollRatio * (el.scrollHeight - el.clientHeight)
      if (top > 0) el.scrollTo({ top })
    }
  }, [selected, mdContent, htmlContent, contentLoading])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const loadDocs = useCallback(async (): Promise<DocumentItem[]> => {
    setLoading(true)
    try {
      const list = await api.listDocuments(colId)
      setDocs(list)
      const cols = await api.listCollections()
      const col = cols.find((c) => c.id === colId) ?? null
      setCollection(col)
      collectionRef.current = col
      setCurrent(col)
      return list
    } finally { setLoading(false) }
  }, [colId])

  useEffect(() => { loadDocs() }, [loadDocs])

  // 卸载时清空面包屑的当前集合
  useEffect(() => () => setCurrent(null), [setCurrent])

  const viewDoc = useCallback(async (doc: DocumentItem) => {
    setSelected(doc); setTocItems([]); setContentLoading(true)
    const col = collectionRef.current
    if (col) {
      trackRecent({ id: doc.id, kind: 'collection', title: doc.title, ext: doc.ext, sourceId: col.id, sourceName: col.name })
    }
    try {
      if (doc.ext === '.md') {
        setMdContent(await api.getRaw(doc.id)); setHtmlContent('')
      } else {
        setHtmlContent(await api.getRaw(doc.id, 'html')); setMdContent('')
      }
    } finally { setContentLoading(false) }
  }, [])

  const handleTocReady = useCallback((items: TocItem[]) => setTocItems(items), [])

  // 列表点选文档：移动端选中后自动关闭 Drawer
  const handleSelectDoc = (doc: DocumentItem) => {
    viewDoc(doc)
    if (isMobile) setDrawerOpen(false)
  }

  // 从搜索结果跳转时自动选中文档（I-2：消费后清理 ?doc=，避免后续 reload 拽回）
  useEffect(() => {
    const docParam = searchParams.get('doc')
    if (loading || !docParam) return
    const docId = Number(docParam)
    if (!docId) return
    const doc = docs.find(d => d.id === docId)
    if (doc) {
      setSearchParams({}, { replace: true })
      viewDoc(doc)
    }
  }, [loading, docs, searchParams, viewDoc])

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

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = docs.findIndex((d) => d.id === active.id)
    const newIndex = docs.findIndex((d) => d.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = [...docs]
    const reordered = [...docs]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    setDocs(reordered)

    if (docSaveTimerRef.current) clearTimeout(docSaveTimerRef.current)
    message.loading({ content: '保存排序中…', key: 'doc-sort', duration: 0 })
    docSaveTimerRef.current = setTimeout(async () => {
      try {
        await Promise.all(reordered.map((d, i) => api.updateDocument(d.id, { sort_order: i })))
        message.success({ content: '排序已保存', key: 'doc-sort' })
      } catch {
        message.error({ content: '保存排序失败，已恢复原顺序', key: 'doc-sort' })
        setDocs(prev)
      }
    }, 600)
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

  const openMoveModal = async (doc: DocumentItem) => {
    setMoveTarget(doc)
    setMoveModalOpen(true)
    const cols = await api.listCollections()
    setCollections(cols)
  }

  const handleMove = async (targetColId: number) => {
    if (!moveTarget) return
    try {
      await api.moveDocument(moveTarget.id, targetColId)
      const targetCol = collections.find(c => c.id === targetColId)
      message.success(`已移动到「${targetCol?.name ?? targetColId}」`)
      setMoveModalOpen(false)
      setMoveTarget(null)
      if (selected?.id === moveTarget.id) {
        setSelected(null); setMdContent(''); setHtmlContent('')
      }
      loadDocs()
    } catch {
      message.error('移动失败，请重试')
    }
  }

  const dropdownItems = (doc: DocumentItem) => ({
    items: [
      { key: 'edit', label: '编辑详情', icon: <EditOutlined />, onClick: () => openEdit(doc) },
      { key: 'download', label: '下载', icon: <DownloadOutlined />, onClick: () => window.open(`/api/documents/${doc.id}/download`) },
      { key: 'move', label: '移动到...', icon: <SwapOutlined />, onClick: () => openMoveModal(doc) },
      { key: 'versions', label: '版本历史', icon: <HistoryOutlined />, onClick: () => setVersionHistoryDoc(doc) },
      ...(doc.share_token ? [{
        key: 'revokeShare', label: '取消分享', icon: <StopOutlined />,
        onClick: () => {
          Modal.confirm({
            title: '取消分享',
            content: '取消后，已分享的链接将立即失效，所有访问者将无法再查看该文档。确认取消？',
            okType: 'danger',
            okText: '取消分享',
            cancelText: '保留',
            onOk: async () => {
              await api.revokeDocShare(doc.id)
              message.success('已取消分享')
              loadDocs()
            },
          })
        },
      }] : []),
      { type: 'divider' as const },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => handleDelete(doc) },
    ],
  })

  const isMd = selected?.ext === '.md'
  const selectedTags = selected?.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? []

  // 侧栏内容：桌面端放 aside，移动端放 Drawer
  const sidebarContent = (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--subtle-border)' }}>
        {collection && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <div style={{
              width: 30, height: 30, borderRadius: 6, background: 'var(--subtle-bg)',
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--ink-500)', fontSize: 14, flexShrink: 0,
            }}>
              <FolderOutlined />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {collection.name}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                {docs.length} files
              </div>
            </div>
          </div>
        )}
        <Button type="primary" icon={<UploadOutlined />} block onClick={() => setUploadOpen(true)} style={{ marginTop: 'var(--space-3)' }}>
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
                <SortableDoc key={doc.id} doc={doc} active={selected?.id === doc.id} onClick={() => handleSelectDoc(doc)} onShare={handleDocShare} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 二级导航栏：面包屑 + 页面级操作 */}
      <SubNav
        actions={isMobile ? (
          <Button type="text" size="small" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开文件列表">文件列表</Button>
        ) : undefined}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* 桌面端左栏：文件列表 */}
      {!isMobile && (
        <aside style={{ width: 'var(--sidebar-w)', borderRight: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
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
      <main ref={mainRef} onScroll={updateProgress} style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
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
                borderBottom: '1px solid var(--subtle-border)', padding: 'var(--space-3) var(--space-8)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Space wrap>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{selected.title}</span>
                  <Tag color={isMd ? 'var(--md-color)' : 'var(--html-color)'} style={{ borderRadius: 4, fontSize: 11 }}>{selected.ext}</Tag>
                  {selectedTags.slice(0, 3).map((t, i) => (
                    <Tag key={t} color={TAG_COLORS[i % TAG_COLORS.length]} style={{ borderRadius: 4, fontSize: 11 }}>{t}</Tag>
                  ))}
                  {selectedTags.length > 3 && (
                    <Tag style={{ borderRadius: 4, fontSize: 11 }} title={selectedTags.slice(3).join('、')}>+{selectedTags.length - 3}</Tag>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
                    {formatSize(selected.size)} · {relativeTime(selected.updated_at)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)', fontWeight: 500 }} title="阅读进度">
                    {readProgress}%
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
                {/* 阅读进度条：transform: scaleX 避免布局抖动 */}
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: 'var(--border)', pointerEvents: 'none' }}>
                  <div style={{ transform: `scaleX(${readProgress / 100})`, transformOrigin: 'left center', height: '100%', background: 'var(--accent)', transition: 'transform 0.12s linear' }} />
                </div>
              </div>

              {selected.note && (
                <div style={{ padding: '6px 32px', background: 'var(--accent-tint)', borderBottom: '1px solid var(--subtle-border)', fontSize: 12, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.05em', flexShrink: 0 }}>备注</span>
                  {selected.note}
                </div>
              )}

              {contentLoading ? (
                <div style={{ padding: 'var(--space-8)', maxWidth: 760, margin: '0 auto' }}><Skeleton active paragraph={{ rows: 8 }} /></div>
              ) : isMd ? (
                <MarkdownViewer content={mdContent} onTocReady={handleTocReady} />
              ) : (
                <div style={{ padding: 'var(--space-6)' }}><HtmlSandbox html={htmlContent} title="文档 HTML 预览" /></div>
              )}
            </div>

            {isMd && tocItems.length > 0 && (
              <aside style={{ width: 'var(--toc-w)', flexShrink: 0, borderLeft: '1px solid var(--subtle-border)' }}>
                <DocToc items={tocItems} />
              </aside>
            )}
          </div>
        )}
      </main>
      </div>

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
              <div style={{ height: '100%', padding: 'var(--space-6)' }}><HtmlSandbox html={htmlContent} fill title="文档全屏预览" /></div>
            )}
          </div>
        </div>
      )}

      <UploadModal
        collectionId={colId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={async () => {
          const list = await loadDocs()
          if (selected) {
            const updated = list.find(d => d.id === selected.id)
            if (updated) viewDoc(updated)
          }
        }}
        existingFilenames={docs.map(d => d.filename)}
      />
      {versionHistoryDoc && (
        <VersionHistoryModal
          docId={versionHistoryDoc.id}
          currentVersion={versionHistoryDoc.current_version ?? 1}
          open={!!versionHistoryDoc}
          onClose={() => setVersionHistoryDoc(null)}
          onRestore={async () => {
            const list = await loadDocs()
            if (selected) {
              const updated = list.find(d => d.id === selected.id)
              if (updated) viewDoc(updated)
            }
          }}
        />
      )}
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

      <Modal
        title={`移动「${moveTarget?.title ?? ''}」`}
        open={moveModalOpen}
        onCancel={() => { setMoveModalOpen(false); setMoveTarget(null) }}
        footer={null}
        width={640}
      >
        {collections.filter(c => c.id !== colId).length === 0 ? (
          <EmptyState icon={<FolderOutlined />} title="暂无其他集合" description="创建新集合后即可移动文档" />
        ) : (
          <Row gutter={[16, 16]} style={{ paddingTop: 8 }}>
            {collections
              .filter(c => c.id !== colId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(c => (
                <Col key={c.id} span={12}>
                  <div
                    className="col-card"
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleMove(c.id)}
                  >
                    <div className="body">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 6, background: 'var(--subtle-bg)',
                          border: '1px solid var(--border)', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: 'var(--ink-500)', fontSize: 15,
                        }}>
                          <FolderOutlined />
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </div>
                      </div>
                      <div className="desc">{c.description || '暂无描述'}</div>
                      <div className="meta">
                        <span>{c.doc_count ?? 0} 篇 · {relativeTime(c.updated_at)}</span>
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
          </Row>
        )}
      </Modal>
    </div>
  )
}
