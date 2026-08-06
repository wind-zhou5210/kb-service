import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Col, Button, Input, Modal, Spin, message } from 'antd'
import { PlusOutlined, SearchOutlined, FolderOutlined, FileTextOutlined, Html5Outlined, FileOutlined } from '@ant-design/icons'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, type Collection } from '../api/client'
import { useCollectionStore } from '../store/collection'
import CollectionCard from '../components/CollectionCard'
import EmptyState from '../components/EmptyState'
import { copyToClipboard } from '../utils/clipboard'
import { getRecent, type RecentDoc } from '../utils/recent'
import { relativeTime } from '../utils/format'

const { TextArea } = Input

function SortableCard({ col, onEdit, onDelete, onShare, onRevokeShare, onClick }: {
  col: Collection
  onEdit: (c: Collection) => void
  onDelete: (id: number) => void
  onShare: (c: Collection) => void
  onRevokeShare: (id: number) => void
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <CollectionCard
        collection={col}
        docCount={col.doc_count}
        onClick={onClick}
        onEdit={() => onEdit(col)}
        onDelete={() => onDelete(col.id)}
        onShare={() => onShare(col)}
        onRevokeShare={() => onRevokeShare(col.id)}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export default function Collections() {
  const list = useCollectionStore((s) => s.list)
  const loaded = useCollectionStore((s) => s.loaded)
  const fetchList = useCollectionStore((s) => s.fetchList)
  const mutate = useCollectionStore((s) => s.mutate)
  const [loading, setLoading] = useState(!loaded)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [editing, setEditing] = useState<Collection | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [shareModal, setShareModal] = useState<Collection | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState<RecentDoc[]>(() => getRecent())
  const navigate = useNavigate()

  // P2-5 拖拽排序：防抖批量保存 + 可撤销
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // M-1：卸载时清掉未触发的防抖 timer，避免切页后仍发请求/弹 toast
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    setRecent(getRecent())
    fetchList().finally(() => setLoading(false))
  }, [fetchList])

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q)
    )
  }, [list, search])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await api.createCollection(newName.trim(), newDesc.trim() || undefined)
    setNewName(''); setNewDesc(''); setCreateOpen(false); await mutate()
  }

  const handleEdit = (c: Collection) => {
    setEditing(c); setEditName(c.name); setEditDesc(c.description ?? '')
  }

  const handleEditSave = async () => {
    if (!editing || !editName.trim()) return
    await api.updateCollection(editing.id, { name: editName.trim(), description: editDesc.trim() || null })
    setEditing(null); await mutate()
  }

  const handleDelete = async (id: number) => { await api.deleteCollection(id); await mutate() }

  const handleShare = async (c: Collection) => {
    const { share_token } = await api.createShareLink(c.id)
    const url = `${window.location.origin}/share/${share_token}`
    setShareUrl(url)
    setShareModal(c)
    await mutate()
  }

  const handleRevokeShare = async (id: number) => {
    await api.revokeShare(id)
    message.success('已取消分享')
    await mutate()
  }

  const persistOrder = async (ordered: Collection[]) => {
    await Promise.all(ordered.map((c, i) => api.updateCollection(c.id, { sort_order: i })))
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = list.findIndex((c) => c.id === active.id)
    const newIndex = list.findIndex((c) => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const prev = [...list]
    const reordered = [...list]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)
    useCollectionStore.setState({ list: reordered })

    // 防抖：停止拖拽 600ms 后再批量持久化，避免逐项请求风暴
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    message.loading({ content: '保存排序中…', key: 'sort-save', duration: 0 })

    saveTimerRef.current = setTimeout(async () => {
      try {
        await persistOrder(reordered)
        message.success({
          content: '排序已保存',
          key: 'sort-save',
          onClick: () => {
            useCollectionStore.setState({ list: prev })
            persistOrder(prev)
          },
        })
        await mutate()
      } catch {
        message.error({ content: '保存排序失败，已恢复原顺序', key: 'sort-save' })
        useCollectionStore.setState({ list: prev })
      }
    }, 600)
  }

  const copyShareUrl = async () => {
    const ok = await copyToClipboard(shareUrl)
    if (ok) message.success('链接已复制')
    else message.warning('复制失败，请手动选中链接复制')
  }

  // 最近阅读「继续」：跳回集合文档 / 工作空间文件
  const goRecent = (r: RecentDoc) => {
    if (r.kind === 'collection') {
      navigate(`/collections/${r.sourceId}?doc=${r.id}`)
    } else {
      navigate(`/workspaces/${r.sourceId}?file=${encodeURIComponent(String(r.id))}`)
    }
  }

  return (
    <div className="paper-grid" style={{ flex: 1, minHeight: '100%' }}>
      <div className="page-container">
      <div className="page-header">
        <div>
          <h1>知识集合</h1>
          <div className="hint">按主题整理单份文档（.md / .html），拖拽卡片可调整顺序</div>
          <div className="sub">
            {list.length} 个集合
          </div>
        </div>
        <div className="actions">
          {list.length > 0 && (
            <Input
              allowClear
              className="page-search"
              prefix={<SearchOutlined style={{ color: 'var(--ink-300)' }} />}
              placeholder="搜索集合..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 260, borderRadius: 'var(--r-md)' }}
            />
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建
          </Button>
        </div>
      </div>

      {/* 知识入口：最近阅读（localStorage 记录，点击继续阅读） */}
      {!loading && !search && recent.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="section-title">
            <span className="name">最近阅读</span>
            <span className="spec">CONTINUE READING</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recent.map((r) => {
              const isMd = r.ext === '.md'
              const isHtml = r.ext === '.html' || r.ext === '.htm'
              return (
                <div key={`${r.kind}:${r.id}`} className="recent-item" onClick={() => goRecent(r)}>
                  <span
                    style={{
                      color: isMd ? 'var(--md-color)' : isHtml ? 'var(--html-color)' : 'var(--ink-400)',
                      fontSize: 14, flexShrink: 0, display: 'inline-flex',
                    }}
                  >
                    {isMd ? <FileTextOutlined /> : isHtml ? <Html5Outlined /> : <FileOutlined />}
                  </span>
                  <span className="recent-title">{r.title}</span>
                  <span className="recent-meta">{r.sourceName} · {relativeTime(new Date(r.viewedAt).toISOString())}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : list.length === 0 ? (
        <div style={{ minHeight: 'calc(100vh - var(--header-h) - 200px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState
            icon={<FolderOutlined />}
            title="还没有知识集合"
            description="创建你的第一个集合，开始整理文档"
            actionText="新建集合"
            onAction={() => setCreateOpen(true)}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ minHeight: 'calc(100vh - var(--header-h) - 200px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={<SearchOutlined />} title="未找到匹配的集合" />
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((c) => c.id)} strategy={rectSortingStrategy}>
            <Row gutter={[20, 20]}>
              {filtered.map((c) => (
                <Col xs={24} sm={12} md={8} lg={8} xl={6} key={c.id}>
                  <SortableCard
                    col={c}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onShare={handleShare}
                    onRevokeShare={handleRevokeShare}
                    onClick={() => navigate(`/collections/${c.id}`)}
                  />
                </Col>
              ))}
            </Row>
          </SortableContext>
        </DndContext>
      )}

      {/* 新建弹窗 */}
      <Modal title="新建知识集合" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} okText="创建" cancelText="取消">
        <div style={{ paddingTop: 8 }}>
          <Input placeholder="集合名称" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ marginBottom: 12 }} />
          <TextArea placeholder="简介（可选）" value={newDesc} rows={3} onChange={(e) => setNewDesc(e.target.value)} />
        </div>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal title="编辑集合" open={!!editing} onOk={handleEditSave} onCancel={() => setEditing(null)} okText="保存" cancelText="取消">
        <div style={{ paddingTop: 8 }}>
          <Input placeholder="集合名称" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ marginBottom: 12 }} />
          <TextArea placeholder="简介（可选）" value={editDesc} rows={3} onChange={(e) => setEditDesc(e.target.value)} />
        </div>
      </Modal>

      {/* 分享链接弹窗 */}
      <Modal
        title="分享集合"
        open={!!shareModal}
        onCancel={() => setShareModal(null)}
        footer={[
          <Button key="close" onClick={() => setShareModal(null)}>关闭</Button>,
          <Button key="copy" type="primary" onClick={copyShareUrl}>复制链接</Button>,
        ]}
      >
        <div style={{ paddingTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 12 }}>
            任何人都可以通过此链接查看「{shareModal?.name}」中的文档（只读）。
          </p>
          <Input.Group compact>
            <Input
              value={shareUrl}
              readOnly
              style={{ width: 'calc(100% - 80px)' }}
            />
            <Button type="primary" onClick={copyShareUrl} style={{ width: 80 }}>复制</Button>
          </Input.Group>
        </div>
      </Modal>
      </div>
    </div>
  )
}
