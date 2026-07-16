import { useState, useEffect } from 'react'
import { Modal, Timeline, Button, Space, message, Tag } from 'antd'
import { HistoryOutlined, EyeOutlined, RollbackOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { formatSize, relativeTime } from '../utils/format'

interface VersionInfo {
  id: number
  document_id: number
  version: number
  content_sha1: string
  filename: string
  ext: string
  size: number
  change_note: string | null
  created_at: string
}

interface Props {
  docId: number
  currentVersion: number
  open: boolean
  onClose: () => void
  onRestore: () => void
}

export default function VersionHistoryModal({ docId, currentVersion, open, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [loading, setLoading] = useState(false)

  const loadVersions = async () => {
    setLoading(true)
    try {
      const data = await api.listVersions(docId)
      setVersions(data)
    } catch {
      message.error('加载版本历史失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadVersions()
  }, [docId, open])

  const handleView = async (v: VersionInfo) => {
    try {
      const data = await api.getVersionContent(docId, v.version)
      const win = window.open('', '_blank')
      if (win) {
        win.document.write(`<pre style="font-size:14px;padding:20px">${data.content}</pre>`)
        win.document.close()
      }
    } catch {
      message.error('查看版本内容失败')
    }
  }

  const handleRestore = (v: VersionInfo) => {
    Modal.confirm({
      title: `恢复至版本 v${v.version}`,
      content: '当前内容将保存为新版本，确定要恢复吗？',
      okText: '确定恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.restoreVersion(docId, v.version)
          message.success(`已恢复至 v${v.version}`)
          onRestore()
          onClose()
        } catch {
          message.error('恢复失败')
        }
      },
    })
  }

  const handleDelete = (v: VersionInfo) => {
    Modal.confirm({
      title: `删除版本 v${v.version}`,
      content: '此操作不可撤销，确定删除？',
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteVersion(docId, v.version)
          message.success(`已删除 v${v.version}`)
          loadVersions()
        } catch {
          message.error('删除失败')
        }
      },
    })
  }

  return (
    <Modal
      title={<><HistoryOutlined style={{ marginRight: 8 }} />版本历史</>}
      open={open}
      onCancel={onClose}
      width={620}
      footer={null}
    >
      <Timeline
        items={versions.map((v) => ({
          color: v.version === currentVersion ? 'blue' : 'gray',
          children: (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              background: v.version === currentVersion ? '#f0f5ff' : undefined,
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 4,
            }}>
              <div>
                <div>
                  <strong>v{v.version}</strong>
                  {v.version === currentVersion && (
                    <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>当前版本</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {formatSize(v.size)} · {relativeTime(v.created_at)}
                </div>
              </div>
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(v)}>
                  查看
                </Button>
                {v.version !== currentVersion && (
                  <>
                    <Button size="small" icon={<RollbackOutlined />} onClick={() => handleRestore(v)}>
                      恢复
                    </Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(v)}>
                      删除
                    </Button>
                  </>
                )}
              </Space>
            </div>
          ),
        }))}
      />
      {versions.length === 0 && !loading && (
        <div style={{ textAlign: 'center', color: '#888', padding: 24 }}>
          暂无历史版本
        </div>
      )}
    </Modal>
  )
}
