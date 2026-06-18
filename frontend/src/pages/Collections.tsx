import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Col, Button, Input, Modal, Spin } from 'antd'
import { PlusOutlined, SearchOutlined, FolderOutlined } from '@ant-design/icons'
import { api, type Collection } from '../api/client'
import CollectionCard from '../components/CollectionCard'
import EmptyState from '../components/EmptyState'

const { TextArea } = Input

export default function Collections() {
  const [list, setList] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try { setList(await api.listCollections()) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

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
    setNewName(''); setNewDesc(''); setCreateOpen(false); load()
  }

  const handleDelete = async (id: number) => { await api.deleteCollection(id); load() }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1280, margin: '0 auto' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
            知识集合
          </h1>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4, fontFamily: 'var(--mono)' }}>
            {list.length} {list.length === 1 ? 'collection' : 'collections'}
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建
        </Button>
      </div>

      {/* 搜索 */}
      {list.length > 0 && (
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--ink-300)' }} />}
          placeholder="搜索集合..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320, marginBottom: 20, borderRadius: 6 }}
        />
      )}

      {/* 内容 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FolderOutlined />}
          title="还没有知识集合"
          description="创建你的第一个集合，开始整理文档"
          actionText="新建集合"
          onAction={() => setCreateOpen(true)}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SearchOutlined />} title="未找到匹配的集合" />
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((c) => (
            <Col xs={24} sm={12} md={8} lg={6} key={c.id}>
              <CollectionCard
                collection={c}
                docCount={c.doc_count}
                onClick={() => navigate(`/collections/${c.id}`)}
                onDelete={() => handleDelete(c.id)}
              />
            </Col>
          ))}
        </Row>
      )}

      <Modal title="新建知识集合" open={createOpen} onOk={handleCreate} onCancel={() => setCreateOpen(false)} okText="创建" cancelText="取消">
        <div style={{ paddingTop: 8 }}>
          <Input placeholder="集合名称" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ marginBottom: 12 }} />
          <TextArea placeholder="简介（可选）" value={newDesc} rows={3} onChange={(e) => setNewDesc(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}
