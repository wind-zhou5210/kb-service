import { Dropdown, Modal, Button } from 'antd'
import { MoreOutlined, DeleteOutlined, EditOutlined, ShareAltOutlined, StopOutlined } from '@ant-design/icons'
import { relativeTime, hashGradient, initials } from '../utils/format'
import type { Collection } from '../api/client'

interface Props {
  collection: Collection
  docCount?: number
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onShare: () => void
  onRevokeShare: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

function sheetNo(id: number): string {
  return `KB-${String(id).padStart(3, '0')}`
}

export default function CollectionCard({ collection, docCount = 0, onClick, onEdit, onDelete, onShare, onRevokeShare, dragHandleProps }: Props) {
  const [g1, g2] = hashGradient(collection.name)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: '删除集合',
      content: `确认删除「${collection.name}」及其下所有文件？此操作不可恢复。`,
      okType: 'danger',
      okText: '删除',
      cancelText: '取消',
      onOk: onDelete,
    })
  }

  const handleRevokeShare = (e: React.MouseEvent) => {
    e.stopPropagation()
    Modal.confirm({
      title: '取消分享',
      content: '取消后，已分享的链接将立即失效，所有访问者将无法再查看。确认取消？',
      okType: 'danger',
      okText: '取消分享',
      cancelText: '保留',
      onOk: onRevokeShare,
    })
  }

  return (
    <div className="col-card" onClick={onClick}>
      {/* 图纸封面：渐变 + 首字 + 图号 */}
      <div className="cover" style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
        <span className="cover-init">{initials(collection.name)}</span>
        <span className="cover-no">{sheetNo(collection.id)}</span>
      </div>
      <div className="body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }} {...dragHandleProps}>
          <div className="title" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
            <div
              style={{
                fontSize: 'var(--text-md)',
                fontWeight: 600,
                color: 'var(--ink-900)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {collection.name}
            </div>
          </div>
          {collection.share_token && (
            <ShareAltOutlined style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', flexShrink: 0 }} aria-label="已分享" />
          )}
        </div>
        <div className="desc" style={collection.description ? undefined : { color: 'var(--ink-400)' }}>
          {collection.description || '暂无描述'}
        </div>
        <div className="title-strip">
          <span className="cell"><b>文档</b>{docCount} 篇</span>
          <span className="cell" style={{ minWidth: 0, overflow: 'hidden' }}><b>更新</b>{relativeTime(collection.updated_at)}</span>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'edit',
                  label: '编辑集合',
                  icon: <EditOutlined />,
                  onClick: ({ domEvent }) => { domEvent.stopPropagation(); onEdit() },
                },
                {
                  key: 'share',
                  label: collection.share_token ? '复制分享链接' : '分享集合',
                  icon: <ShareAltOutlined />,
                  onClick: ({ domEvent }) => { domEvent.stopPropagation(); onShare() },
                },
                ...(collection.share_token ? [{
                  key: 'revoke-share',
                  label: '取消分享',
                  icon: <StopOutlined />,
                  onClick: ({ domEvent }: { domEvent: any }) => handleRevokeShare(domEvent),
                }] : []),
                { type: 'divider' as const },
                {
                  key: 'delete',
                  label: '删除集合',
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: ({ domEvent }: { domEvent: any }) => { domEvent.stopPropagation(); handleDelete(domEvent) },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button
              type="text"
              size="small"
              aria-label="集合操作"
              icon={<MoreOutlined />}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--ink-400)' }}
            />
          </Dropdown>
        </div>
      </div>
    </div>
  )
}
