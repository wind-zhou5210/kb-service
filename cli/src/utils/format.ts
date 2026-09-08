import chalk from 'chalk';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function formatTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/** 剔离后端 FTS5 snippet 的 <<>> 命中标记，返回按可见长度截断的纯文本 */
export function plainSnippet(snippet: string, maxLen: number): string {
  return truncate(snippet.replace(/<<(.+?)>>/g, '$1'), maxLen);
}

/**
 * 渲染全文检索摘要：后端 FTS5 snippet 用 <<>> 标记命中词（前端解析为高亮）。
 * 终端先剔离标记按可见长度截断，再对命中词着色，避免 ANSI 码干扰截断长度。
 * 注：--json 输出请用 plainSnippet，否则 ANSI 转义码会污染机器可读结果。
 */
export function highlightSnippet(snippet: string, maxLen: number): string {
  const hits = [...snippet.matchAll(/<<(.+?)>>/g)].map((m) => m[1]);
  const cut = plainSnippet(snippet, maxLen);
  return hits.reduce((acc, h) => acc.split(h).join(chalk.yellow.bold(h)), cut);
}
