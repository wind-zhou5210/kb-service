import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Row, Col, Modal, Input, Skeleton, message, Tooltip } from 'antd'
import { PlusOutlined, FolderOutlined, DeleteOutlined } from '@ant-design/icons'
import { api, type Workspace } from '../api/client'
import { useWorkspaceStore } from '../store/workspace'
import { formatSize, hashGradient, initials } from '../utils/format'
import EmptyState from '../components/EmptyState'

const { TextArea } = Input

export default function Workspaces() {
  const list = useWorkspaceStore((s) => s.list)
  const loaded = useWorkspaceStore((s) => s.loaded)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const mutate = useWorkspaceStore((s) => s.mutate)
  const [loading, setLoading] = useState(!loaded)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchList().finally(() => setLoading(false))
  }, [fetchList])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await api.createWorkspace(newName.trim(), newDesc.trim() || undefined)
    setNewName('')
    setNewDesc('')
    setCreateOpen(false)
    message.success('工作空间已创建')
    await mutate()
  }

  const handleDelete = (ws: Workspace, e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: '删除工作空间',
      content: `确认删除「${ws.name}」及其下所有文件？此操作不可恢复。`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        await api.deleteWorkspace(ws.id)
        message.success('工作空间已删除')
        await mutate()
      },
    })
  }

  return (
    <div className="paper-grid" style={{ flex: 1, minHeight: '100%' }}>
      <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>工作空间</h1>
          <div className="hint">按目录结构组织文件，支持 zip 整体上传，适合文件夹式知识库</div>
          <div className="sub">
            {list.length} 个工作空间
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建工作空间
        </Button>
      </div>

      {/* Loading state */}
      {loading ? (
        <Row gutter={[20, 20]}>
          {[1, 2, 3].map((i) => (
            <Col xs={24} sm={12} md={8} lg={8} xl={6} key={i}>
              <Card style={{ borderRadius: 8 }}>
                <Skeleton active />
              </Card>
            </Col>
          ))}
        </Row>
      ) : list.length === 0 ? (
        /* Empty state */
        <div style={{ minHeight: 'calc(100vh - var(--header-h) - 200px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState
            icon={<FolderOutlined />}
            title="还没有工作空间"
            description="创建一个工作空间来整理和管理你的文档"
            actionText="新建工作空间"
            onAction={() => setCreateOpen(true)}
          />
        </div>
      ) : (
        /* Workspace grid —— 图纸卡：与集合卡同一制图语言 */
        <Row gutter={[20, 20]}>
          {list.map((ws) => (
            <Col xs={24} sm={12} md={8} lg={8} xl={6} key={ws.id}>
              <div className="col-card" onClick={() => navigate(`/workspaces/${ws.id}`)}>
                <div className="cover" style={{ background: `linear-gradient(135deg, ${hashGradient(ws.name)[0]}, ${hashGradient(ws.name)[1]})` }}>
                  <span className="cover-init">{initials(ws.name)}</span>
                  <span className="cover-no">WS-{String(ws.id).padStart(3, '0')}</span>
                </div>
                <div className="body">
                  <div className="title" style={{ marginBottom: 'var(--space-2)' }}>{ws.name}</div>
                  <div className="desc" style={ws.description ? undefined : { color: 'var(--ink-400)' }}>
                    {ws.description || '暂无描述'}
                  </div>
                  <div className="title-strip">
                    <span className="cell"><b>文件</b>{ws.file_count}</span>
                    <span className="cell"><b>体积</b>{formatSize(ws.total_size)}</span>
                    <Tooltip title="删除工作空间">
                      <Button type="text" size="small" icon={<DeleteOutlined />} aria-label="删除工作空间" onClick={(e) => handleDelete(ws, e)} danger />
                    </Tooltip>
                  </div>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Create modal */}
      <Modal
        title="新建工作空间"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <div style={{ paddingTop: 8 }}>
          <Input
            placeholder="工作空间名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <TextArea
            placeholder="简介（可选）"
            value={newDesc}
            rows={3}
            onChange={(e) => setNewDesc(e.target.value)}
          />
        </div>
      </Modal>
      </div>
    </div>
  )
}
