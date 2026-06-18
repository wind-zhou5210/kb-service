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
      const top = el.getBoundingClientRect().top + window.scrollY - 68
      window.scrollTo({ top, behavior: 'smooth' })
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
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <VerticalAlignTopOutlined /> 回到顶部
      </div>
    </div>
  )
}
