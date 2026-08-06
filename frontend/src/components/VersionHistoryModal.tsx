import { useState, useEffect } from 'react'
import { Modal, Timeline, Button, Space, message, Tag } from 'antd'
import { HistoryOutlined, EyeOutlined, RollbackOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import { formatSize, relativeTime } from '../utils/format'
import MarkdownViewer from './MarkdownViewer'

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
  // P0-1：版本内容应用内查看（替代裸白窗 window.open）
  const [viewing, setViewing] = useState<{ v: VersionInfo; content: string } | null>(null)

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
      setViewing({ v, content: data.content })
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
    <>
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
              background: v.version === currentVersion ? 'var(--accent-tint)' : undefined,
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
                <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>
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
        <div style={{ textAlign: 'center', color: 'var(--ink-400)', padding: 24 }}>
          暂无历史版本
        </div>
      )}
    </Modal>

    {/* 版本内容查看：应用内渲染（md 用阅读器，html 用制图风格源码） */}
    <Modal
      title={<><EyeOutlined style={{ marginRight: 8 }} />版本 v{viewing?.v.version} 内容</>}
      open={!!viewing}
      onCancel={() => setViewing(null)}
      width={780}
      footer={null}
    >
      {viewing && (
        <>
          <div className="dim" style={{ marginBottom: 12 }}>
            v{viewing.v.version} · {formatSize(viewing.v.size)} · {relativeTime(viewing.v.created_at)} · {viewing.v.filename}
          </div>
          {viewing.v.ext === '.md' ? (
            <div style={{ maxHeight: '62vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <MarkdownViewer content={viewing.content} />
            </div>
          ) : (
            <pre style={{ maxHeight: '62vh', overflow: 'auto', background: 'var(--ink-900)', color: '#E8E6E0', padding: 16, borderRadius: 6, fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--mono)', margin: 0 }}>
              {viewing.content}
            </pre>
          )}
        </>
      )}
    </Modal>
    </>
  )
}
