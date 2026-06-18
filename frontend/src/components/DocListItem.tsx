import { FileTextOutlined, Html5Outlined } from '@ant-design/icons'
import { formatSize, relativeTime } from '../utils/format'
import type { DocumentItem } from '../api/client'

const TAG_COLORS = ['#4F46E5', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899']

interface Props {
  doc: DocumentItem
  active: boolean
  onClick: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
}

export default function DocListItem({ doc, active, onClick, dragHandleProps }: Props) {
  const isMd = doc.ext === '.md'
  const tags = doc.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? []
  return (
    <div className={`doc-item ${active ? 'active' : ''}`} onClick={onClick} {...dragHandleProps}>
      <span className="doc-icon" style={{ color: isMd ? 'var(--color-md)' : 'var(--color-html)' }}>
        {isMd ? <FileTextOutlined /> : <Html5Outlined />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="doc-name">{doc.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {formatSize(doc.size)} · {relativeTime(doc.created_at)}
          </span>
          {tags.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 2, marginLeft: 2 }}>
              {tags.slice(0, 3).map((t, i) => (
                <span
                  key={t}
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: TAG_COLORS[i % TAG_COLORS.length],
                    display: 'inline-block',
                  }}
                />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
