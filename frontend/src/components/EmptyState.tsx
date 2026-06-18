import { Button } from 'antd'

interface Props {
  icon: React.ReactNode
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
}

export default function EmptyState({ icon, title, description, actionText, onAction }: Props) {
  return (
    <div className="empty-wrap">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {actionText && onAction && (
        <Button type="primary" onClick={onAction}>{actionText}</Button>
      )}
    </div>
  )
}
