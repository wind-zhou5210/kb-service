import { useEffect, useState, memo } from 'react'

interface Props {
  /** 后端包装好的 HTML 字符串（已净化 + 注入脚本），作为 iframe srcdoc */
  html: string
  /** fill 模式：iframe 高度 100% 填充父容器（用于全屏），否则用视口高度 */
  fill?: boolean
}

/**
 * HTML 沙箱渲染器 —— 方案安全核心。
 *
 * 渲染策略：iframe + sandbox，绝不 innerHTML。
 * - sandbox="allow-scripts"：只放开脚本执行，不给同源权限。
 *   铁律：永远不同时加 allow-same-origin（二者并存沙箱可被越狱）。
 * - srcdoc 内联内容：iframe 内脚本运行在 opaque origin，无法读父页面 cookie/DOM。
 *
 * 高度策略：默认固定视口高度（减去顶栏/header/padding）内部滚动；
 * fill 模式下高度 100% 填充父容器（用于全屏覆盖层）。
 */
function HtmlSandboxInner({ html, fill }: Props) {
  const [height, setHeight] = useState(600)

  useEffect(() => {
    if (fill) return  // fill 模式用 100%，不监听视口
    // 52=app-header，44=文档顶栏，48=iframe 容器上下 padding
    const calc = () => setHeight(Math.max(window.innerHeight - 52 - 44 - 48, 300))
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [fill])

  return (
    <iframe
      title="html-content"
      sandbox="allow-scripts"
      srcDoc={html}
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
