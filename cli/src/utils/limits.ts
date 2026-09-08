/**
 * 上传体积限制（MB）——与后端 settings 及前端 utils/uploadLimit.ts 三方对齐：
 * workspace_max_upload_mb=500 / package_max_upload_mb=100 / max_upload_mb=10
 */
export const WORKSPACE_ZIP_MAX_MB = 500;
export const PACKAGE_ZIP_MAX_MB = 100;
export const DOCUMENT_MAX_MB = 10;

export function mbBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/** 按请求 URL 推断该端点的体积限制说明，用于中间层（nginx）拦截时补文案 */
export function limitTextForUrl(url: string): string {
  if (/\/workspaces\/\d+\/(upload|files)/.test(url)) {
    return `工作空间文件上限 ${WORKSPACE_ZIP_MAX_MB}MB`;
  }
  if (/\/documents\/package/.test(url)) {
    return `zip 文档包上限 ${PACKAGE_ZIP_MAX_MB}MB`;
  }
  if (/\/documents/.test(url)) {
    return `单文档上限 ${DOCUMENT_MAX_MB}MB`;
  }
  return '超过服务端上传限制';
}

/**
 * 统一上传错误文案。
 * 优先展示后端 JSON detail；nginx 等中间层返回的 413 是 HTML 错误页（无 detail），
 * 此时按 URL 给出限制说明，避免用户只看到空泛的「上传失败」。
 */
export function describeUploadError(err: any, url: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (err?.response?.status === 413) {
    return `文件超过上传限制（${limitTextForUrl(url)}），请精简后重试`;
  }
  const msg = err?.message || String(err);
  return msg || '上传失败，请检查网络后重试';
}

/** 上传前体积校验：返回超限描述，未超限返回 null */
export function checkSizeLimit(
  size: number,
  limitMb: number,
  label: string
): string | null {
  if (size > mbBytes(limitMb)) {
    return `${label} 过大（${formatMb(size)}），上限 ${limitMb}MB，请精简后重试`;
  }
  return null;
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
