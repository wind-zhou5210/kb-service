import { useEffect, useState } from 'react'
import { VerticalAlignTopOutlined } from '@ant-design/icons'

export interface TocItem {
  id: string
  text: string
  level: number
}

interface Props {
  items: TocItem[]
}

/** Markdown 目录侧栏：滚动高亮 + 点击跳转 + 回到顶部 */
export default function DocToc({ items }: Props) {
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    if (!items.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 }
    )
    items.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [items])

  const handleClick = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      // 定位到 <main> 滚动容器（而非 window），避免整体页面滚动
      const container = el.closest('main')
      if (container) {
        const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 60
        container.scrollTo({ top: offset, behavior: 'smooth' })
      }
    }
  }

  if (!items.length) return null

  return (
    <div className="doc-toc">
      <div className="toc-label">ON THIS PAGE</div>
      {items.map((item) => (
        <div
          key={item.id}
          className={`toc-item l${item.level} ${activeId === item.id ? 'active' : ''}`}
          onClick={() => handleClick(item.id)}
        >
          {item.text}
        </div>
      ))}
      <div
        className="toc-item"
        style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--ink-50)' }}
        onClick={() => {
          const container = document.querySelector('main')
          if (container) container.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        <VerticalAlignTopOutlined /> 回到顶部
      </div>
    </div>
  )
}
