import { FileTextOutlined, Html5Outlined } from '@ant-design/icons'
import { formatSize, relativeTime } from '../utils/format'
import type { DocumentItem } from '../api/client'

interface Props {
  doc: DocumentItem
  active: boolean
  onClick: () => void
}

export default function DocListItem({ doc, active, onClick }: Props) {
  const isMd = doc.ext === '.md'
  return (
    <div className={`doc-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="doc-icon" style={{ color: isMd ? 'var(--color-md)' : 'var(--color-html)' }}>
        {isMd ? <FileTextOutlined /> : <Html5Outlined />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="doc-name">{doc.title}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
          {formatSize(doc.size)} · {relativeTime(doc.created_at)}
        </div>
      </div>
    </div>
  )
}
