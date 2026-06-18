import { Dropdown, Modal } from 'antd'
import { MoreOutlined, DeleteOutlined, FolderOutlined } from '@ant-design/icons'
import { relativeTime } from '../utils/format'
import type { Collection } from '../api/client'

interface Props {
  collection: Collection
  docCount?: number
  onClick: () => void
  onDelete: () => void
}

export default function CollectionCard({ collection, docCount = 0, onClick, onDelete }: Props) {
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

  return (
    <div className="col-card" onClick={onClick}>
      <div className="body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: 'var(--ink-50)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-500)',
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            <FolderOutlined />
          </div>
          <div className="title" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
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
              {collection.name}
            </div>
          </div>
        </div>
        <div className="desc">
          {collection.description || '暂无描述'}
        </div>
        <div className="meta">
          <span>{docCount} 篇 · {relativeTime(collection.updated_at)}</span>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'delete',
                  label: '删除集合',
                  icon: <DeleteOutlined />,
                  danger: true,
                  onClick: ({ domEvent }) => { domEvent.stopPropagation(); onDelete() },
                },
              ],
            }}
            trigger={['click']}
          >
            <span
              onClick={(e) => e.stopPropagation()}
              style={{ padding: '2px 6px', borderRadius: 4, cursor: 'pointer', color: 'var(--ink-400)' }}
            >
              <MoreOutlined />
            </span>
          </Dropdown>
        </div>
      </div>
    </div>
  )
}
