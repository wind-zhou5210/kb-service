import { useEffect, useRef, useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import type { TocItem } from './DocToc'

interface Props {
  content: string
  onTocReady?: (items: TocItem[]) => void
  onInternalLink?: (path: string) => void
  workspaceServePrefix?: string  // e.g. "/api/workspaces/1/serve/"
}

function MarkdownViewerInner({ content, onTocReady, onInternalLink, workspaceServePrefix }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 渲染后从 DOM 提取标题，生成 TOC
  useEffect(() => {
    if (!containerRef.current || !onTocReady) return
    const headings = containerRef.current.querySelectorAll('h1, h2, h3')
    const items: TocItem[] = Array.from(headings).map((h) => ({
      id: h.id,
      text: h.textContent || '',
      level: Number(h.tagName[1]),
    }))
    onTocReady(items)
  }, [content, onTocReady])

  // 图片点击放大
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        window.open((target as HTMLImageElement).src, '_blank')
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  // 拦截 workspace 内部链接，在页面内导航
  useEffect(() => {
    const root = containerRef.current
    if (!root || !onInternalLink || !workspaceServePrefix) return

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a')
      if (!a) return
      const href = a.getAttribute('href')
      if (!href) return

      // Don't intercept external URLs or anchor links
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) return

      // Check if it's a workspace internal link
      if (href.startsWith(workspaceServePrefix)) {
        e.preventDefault()
        const path = href.slice(workspaceServePrefix.length)
        onInternalLink(path)
      }
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [content, onInternalLink, workspaceServePrefix])

  return (
    <div className="md-body" ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={
          [
            rehypeHighlight,
            rehypeSlug,
            [rehypeAutolinkHeadings, { behavior: 'wrap' }],
            rehypeKatex,
          ] as never
        }
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

const MarkdownViewer = memo(MarkdownViewerInner)
export default MarkdownViewer
