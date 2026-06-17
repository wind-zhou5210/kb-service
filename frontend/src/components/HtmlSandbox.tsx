import { useEffect, useRef, useState, memo } from 'react'

interface Props {
  /** 后端包装好的 HTML 字符串（已净化 + 注入高度上报脚本），作为 iframe srcdoc */
  html: string
}

/**
 * HTML 沙箱渲染器 —— 方案安全核心。
 *
 * 渲染策略：iframe + sandbox，绝不 innerHTML。
 * - sandbox="allow-scripts"：只放开脚本执行，不给同源权限。
 *   铁律：永远不同时加 allow-same-origin（二者并存沙箱可被越狱）。
 * - srcdoc 内联内容：iframe 内脚本运行在 opaque origin，无法读父页面 cookie/DOM。
 * - 高度自适应：监听 iframe 内 postMessage 上报的 kb-resize，调整 iframe 高度。
 */
function HtmlSandboxInner({ html }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(400)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // sandbox srcdoc 的 origin 是 "null"
      if (e.origin !== 'null' && e.origin !== window.location.origin) return
      if (e.data?.type === 'kb-resize' && typeof e.data.height === 'number') {
        // 防抖式更新，取上报高度与最小值中较大者
        setHeight(Math.max(e.data.height, 200))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      title="html-content"
      sandbox="allow-scripts"
      srcDoc={html}
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{
        width: '100%',
        height: `${height}px`,
        border: 'none',
        display: 'block',
      }}
    />
  )
}

const HtmlSandbox = memo(HtmlSandboxInner)
export default HtmlSandbox
