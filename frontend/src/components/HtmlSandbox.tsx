import { useEffect, useState, useRef, memo } from 'react'

interface Props {
  /** 后端包装好的 HTML 字符串（已净化 + 注入脚本），作为 iframe srcdoc */
  html?: string
  /** 外部 URL 直接加载（用于 workspace file serving），与 html 互斥 */
  src?: string
  /** fill 模式：iframe 高度 100% 填充父容器（用于全屏），否则用视口高度 */
  fill?: boolean
}

/**
 * HTML 沙箱渲染器 —— 方案安全核心。
 *
 * 渲染策略：iframe + sandbox，绝不 innerHTML。
 * - sandbox="allow-scripts"：只放开脚本执行，不给同源权限。
 *   铁律：永远不同时加 allow-same-origin（二者并存沙箱可被越狱）。
 * - srcdoc 内联内容 / src 外部加载：iframe 内脚本运行在 opaque origin，
 *   无法读父页面 cookie/DOM。
 *
 * 两种模式：
 * - html 模式（srcdoc）：传入 HTML 字符串内联渲染（存库文档）
 * - src 模式：传入 URL 直接加载（workspace 文件预览）
 *
 * 高度策略：默认固定视口高度（减去顶栏/header/padding）内部滚动；
 * fill 模式下高度 100% 填充父容器（用于全屏覆盖层）。
 */
function HtmlSandboxInner({ html, src, fill }: Props) {
  const [height, setHeight] = useState(600)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (fill) return  // fill 模式用 100%，不监听视口
    // 52=app-header，44=文档顶栏，48=iframe 容器上下 padding
    const calc = () => setHeight(Math.max(window.innerHeight - 52 - 44 - 48, 300))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [fill])

  // 监听 iframe 内 postMessage（srcdoc 和 src 模式均适用）
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'kb-resize' && iframeRef.current) {
        iframeRef.current.style.height = `${Math.max(e.data.height, 300)}px`
      }
      if (e.data?.type === 'kb-navigate') {
        window.dispatchEvent(new CustomEvent('ws-navigate', { detail: e.data.path }))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  if (!html && !src) {
    return null
  }

  return (
    <iframe
      ref={iframeRef}
      title="html-content"
      sandbox="allow-scripts"
      {...(src ? { src } : { srcDoc: html })}
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{
        width: '100%',
        height: fill ? '100%' : `${height}px`,
        border: 'none',
        display: 'block',
      }}
    />
  )
}

const HtmlSandbox = memo(HtmlSandboxInner)
export default HtmlSandbox
