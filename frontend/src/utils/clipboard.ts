/**
 * 健壮的复制到剪贴板工具。
 *
 * 优先使用 Clipboard API（需安全上下文：HTTPS 或 localhost），
 * 失败时回退到已废弃但仍广泛支持的 document.execCommand('copy')。
 * 适用于 iframe（如预览浏览器缺 clipboard-write 权限）等受限环境。
 *
 * @returns 是否复制成功
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. 优先 Clipboard API（仅在安全上下文可用）
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒或不允许，进入回退
  }
  // 2. 回退：临时 textarea + execCommand('copy')
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    // 兼容移动端
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
