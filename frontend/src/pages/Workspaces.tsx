import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Row, Col, Modal, Input, Skeleton, message, Tooltip } from 'antd'
import { PlusOutlined, FolderOutlined, DeleteOutlined } from '@ant-design/icons'
import { api, type Workspace } from '../api/client'
import { useWorkspaceStore } from '../store/workspace'
import { formatSize, relativeTime } from '../utils/format'
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
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>工作空间</h1>
          <div className="sub">
            {list.length} {list.length === 1 ? 'workspace' : 'workspaces'}
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
        /* Workspace grid */
        <Row gutter={[20, 20]}>
          {list.map((ws) => (
            <Col xs={24} sm={12} md={8} lg={8} xl={6} key={ws.id}>
              <Card
                hoverable
                className="ws-card"
                onClick={() => navigate(`/workspaces/${ws.id}`)}
                style={{ borderRadius: 8 }}
                actions={[
                  <Tooltip title="删除工作空间" key="delete">
                    <DeleteOutlined onClick={(e) => handleDelete(ws, e)} />
                  </Tooltip>,
                ]}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: 'var(--subtle-bg)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      color: 'var(--ink-500)',
                      flexShrink: 0,
                    }}
                  >
                    <FolderOutlined />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: 'var(--ink-900)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ws.name}
                    </div>
                    <div
                      style={{
                        fontSize: 'var(--text-base)',
                        color: 'var(--ink-500)',
                        marginTop: 'var(--space-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {ws.description || '暂无描述'}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--ink-400)' }}>
                  <span>{ws.file_count} 个文件</span>
                  <span>{formatSize(ws.total_size)}</span>
                </div>
                <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--ink-300)' }}>
                  {relativeTime(ws.updated_at)}
                </div>
              </Card>
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
  )
}
