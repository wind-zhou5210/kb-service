import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Layout, Tree, Button, Spin, Empty, Dropdown, Modal, Input, Tag, Space, Typography,
} from 'antd'
import {
  ArrowLeftOutlined, FileTextOutlined, Html5Outlined, UploadOutlined,
  DeleteOutlined, DownloadOutlined, MoreOutlined, ReloadOutlined,
} from '@ant-design/icons'
import type { TreeDataNode } from 'antd'
import { api, type DocumentItem } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import UploadModal from '../components/UploadModal'

const { Sider, Content } = Layout
const { Title, Text } = Typography

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>()
  const colId = Number(id)
  const navigate = useNavigate()

  const [docs, setDocs] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<DocumentItem | null>(null)
  const [mdContent, setMdContent] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [renaming, setRenaming] = useState<DocumentItem | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.listDocuments(colId)
      setDocs(list)
    } finally {
      setLoading(false)
    }
  }, [colId])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  // 选中文档时加载内容
  const viewDoc = useCallback(async (doc: DocumentItem) => {
    setSelected(doc)
    setContentLoading(true)
    try {
      if (doc.ext === '.md') {
        const raw = await api.getRaw(doc.id)
        setMdContent(raw)
        setHtmlContent('')
      } else {
        const wrapped = await api.getRaw(doc.id, 'html')
        setHtmlContent(wrapped)
        setMdContent('')
      }
    } finally {
      setContentLoading(false)
    }
  }, [])

  const treeData: TreeDataNode[] = docs.map((d) => ({
    key: d.id,
    title: d.title, // 仅作 fallback，实际渲染由 titleRender 接管
  }))

  const handleDelete = (doc: DocumentItem) => {
    Modal.confirm({
      title: '删除文件',
      content: `确认删除「${doc.filename}」？`,
      okType: 'danger',
      onOk: async () => {
        await api.deleteDocument(doc.id)
        if (selected?.id === doc.id) setSelected(null)
        loadDocs()
      },
    })
  }

  const handleRename = async () => {
    if (!renaming || !renameTitle.trim()) return
    await api.updateDocument(renaming.id, { title: renameTitle.trim() })
    setRenaming(null)
    loadDocs()
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

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={280} theme="light" style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} type="text" />
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)} block>
            上传
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadDocs} type="text" />
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : docs.length === 0 ? (
          <Empty description="无文件" style={{ marginTop: 60 }} />
        ) : (
          <Tree
            treeData={treeData}
            selectedKeys={selected ? [selected.id] : []}
            onSelect={(keys) => {
              const doc = docs.find((d) => d.id === keys[0])
              if (doc) viewDoc(doc)
            }}
            blockNode
            showLine
            titleRender={(node) => {
              const doc = docs.find((d) => d.id === node.key)
              if (!doc) return null
              return (
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => viewDoc(doc)}
                >
                  <Space size={4}>
                    {doc.ext === '.md'
                      ? <FileTextOutlined style={{ color: '#1677ff' }} />
                      : <Html5Outlined style={{ color: '#e34c26' }} />}
                    <span>{doc.title}</span>
                  </Space>
                  <Dropdown menu={dropdownItems(doc)} trigger={['click']}>
                    <MoreOutlined onClick={(e) => e.stopPropagation()} style={{ marginLeft: 8 }} />
                  </Dropdown>
                </div>
              )
            }}
          />
        )}
      </Sider>
      <Content style={{ overflow: 'auto', background: '#fff' }}>
        {!selected ? (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <Empty description="选择左侧文件查看内容" />
          </div>
        ) : contentLoading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
        ) : (
          <div>
            <div style={{ padding: '12px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
              <Space>
                <Title level={5} style={{ margin: 0 }}>{selected.title}</Title>
                <Tag color={selected.ext === '.md' ? 'blue' : 'orange'}>{selected.ext}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {(selected.size / 1024).toFixed(1)} KB
                </Text>
              </Space>
            </div>
            {selected.ext === '.md' ? (
              <MarkdownViewer content={mdContent} />
            ) : (
              <div style={{ padding: 16 }}>
                <HtmlSandbox html={htmlContent} />
              </div>
            )}
          </div>
        )}
      </Content>

      <UploadModal
        collectionId={colId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={loadDocs}
      />

      <Modal
        title="重命名"
        open={!!renaming}
        onOk={handleRename}
        onCancel={() => setRenaming(null)}
        okText="确认"
        cancelText="取消"
      >
        <Input value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} />
      </Modal>
    </Layout>
  )
}
