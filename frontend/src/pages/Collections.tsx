import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Row, Col, Card, Button, Input, Modal, Empty, Spin, Dropdown, Typography } from 'antd'
import { PlusOutlined, FolderOutlined, MoreOutlined, DeleteOutlined } from '@ant-design/icons'
import { api, type Collection } from '../api/client'
import { useAuth } from '../store/auth'

const { TextArea } = Input
const { Title, Paragraph } = Typography

export default function Collections() {
  const [list, setList] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const navigate = useNavigate()
  const logout = useAuth((s) => s.logout)

  const load = async () => {
    setLoading(true)
    try {
      setList(await api.listCollections())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await api.createCollection(newName.trim(), newDesc.trim() || undefined)
    setNewName('')
    setNewDesc('')
    setCreateOpen(false)
    load()
  }

  const handleDelete = (c: Collection) => {
    Modal.confirm({
      title: '删除集合',
      content: `确认删除「${c.name}」及其下所有文件？此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        await api.deleteCollection(c.id)
        load()
      },
    })
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <FolderOutlined style={{ marginRight: 8 }} />
          知识集合
        </Title>
        <div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建集合
          </Button>
          <Button type="text" onClick={logout} style={{ marginLeft: 8 }}>
            退出
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin />
        </div>
      ) : list.length === 0 ? (
        <Empty description="还没有知识集合，点击右上角新建">
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建集合
          </Button>
        </Empty>
      ) : (
        <Row gutter={[16, 16]}>
          {list.map((c) => (
            <Col xs={24} sm={12} md={8} lg={6} key={c.id}>
              <Card
                hoverable
                onClick={() => navigate(`/collections/${c.id}`)}
                actions={[
                  <Dropdown
                    key="more"
                    menu={{
                      items: [
                        {
                          key: 'delete',
                          label: '删除集合',
                          icon: <DeleteOutlined />,
                          danger: true,
                          onClick: ({ domEvent }) => {
                            domEvent.stopPropagation()
                            handleDelete(c)
                          },
                        },
                      ],
                    }}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <MoreOutlined />
                    </span>
                  </Dropdown>,
                ]}
              >
                <Card.Meta
                  avatar={
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 22,
                      }}
                    >
                      <FolderOutlined />
                    </div>
                  }
                  title={c.name}
                  description={
                    <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, minHeight: 44 }}>
                      {c.description || '暂无描述'}
                    </Paragraph>
                  }
                />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title="新建知识集合"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="集合名称"
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
      </Modal>
    </div>
  )
}
