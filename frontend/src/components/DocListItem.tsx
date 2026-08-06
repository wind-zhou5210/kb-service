import { FileTextOutlined, Html5Outlined, ShareAltOutlined } from '@ant-design/icons'
import { formatSize, relativeTime } from '../utils/format'
import type { DocumentItem } from '../api/client'

interface Props {
  doc: DocumentItem
  active: boolean
  onClick: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  onShare?: (doc: DocumentItem) => void
}

export default function DocListItem({ doc, active, onClick, dragHandleProps, onShare }: Props) {
  const isMd = doc.ext === '.md'
  const tags = doc.tags?.split(',').map(t => t.trim()).filter(Boolean) ?? []
  return (
    <div className={`doc-item ${active ? 'active' : ''}`} onClick={onClick} {...dragHandleProps}>
      <span className="doc-icon" style={{ color: isMd ? 'var(--md-color)' : 'var(--html-color)' }}>
        {isMd ? <FileTextOutlined /> : <Html5Outlined />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div className="doc-name">{doc.title}</div>
          {(doc.current_version ?? 1) > 1 && (
            <span className="doc-tag" title="版本号">v{doc.current_version}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-400)', flexShrink: 0 }}>
            {formatSize(doc.size)} · {relativeTime(doc.created_at)}
          </span>
          {tags.length > 0 && (
            <span style={{ display: 'inline-flex', gap: 3, marginLeft: 2, overflow: 'hidden' }}>
              {tags.slice(0, 2).map((t) => (
                <span key={t} className="doc-tag" title={t}>{t}</span>
              ))}
              {tags.length > 2 && <span className="doc-tag" title={tags.slice(2).join('、')}>+{tags.length - 2}</span>}
            </span>
          )}
        </div>
      </div>
      {onShare && (
        <button
          type="button"
          className="doc-share-btn"
          aria-label="分享文档"
          title="分享文档"
          onClick={(e) => { e.stopPropagation(); onShare(doc) }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ShareAltOutlined style={{ fontSize: 13 }} />
        </button>
      )}
    </div>
  )
}
