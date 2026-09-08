/** 上传体积限制（MB），与后端 settings 对齐：
 * workspace_max_upload_mb=500 / package_max_upload_mb=100 / max_upload_mb=10 */
export const WORKSPACE_ZIP_MAX_MB = 500
export const PACKAGE_ZIP_MAX_MB = 100
export const DOCUMENT_MAX_MB = 10

export const mbBytes = (mb: number) => mb * 1024 * 1024

/** 统一上传错误文案。
 * 优先展示后端 JSON detail；nginx 等中间层返回的 413 是 HTML 错误页（无 detail），
 * 此时给出限制说明，避免用户只看到空泛的「上传失败」。 */
export function describeUploadError(e: any, limitText: string): string {
  const detail = e?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (e?.response?.status === 413) return `文件超过上传限制（${limitText}），请精简后重试`
  return '上传失败，请检查网络后重试'
}
