import { useEffect, useRef, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'

interface Props {
  content: string
}

/**
 * Markdown 渲染器。
 *
 * 安全要点：
 * - react-markdown 默认不渲染原始 HTML 标签（等价 markdown-it 的 html:false），
 *   即使用户在 .md 里写了 <script>，也只当纯文本显示。切勿引入 rehype-raw 放开。
 * - 用 components 自定义渲染 img，实现点击放大。
 */
function MarkdownViewerInner({ content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 点击图片放大（简易预览）
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const src = (target as HTMLImageElement).src
        window.open(src, '_blank')
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [content])

  return (
    <div className="md-body" ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // rehype 插件间 vfile 类型版本偶有冲突，统一断言绕过（运行时无影响）
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
