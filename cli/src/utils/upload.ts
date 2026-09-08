import * as fs from 'fs';
import * as path from 'path';
import { formatSize } from './format';

/**
 * 生成上传进度回调：以百分比 + 已传字节更新 spinner 文案。
 * 大文件（工作空间 zip 可达 500MB）上传耗时长，静态 spinner 无法反映进展。
 */
export function uploadProgress(
  onText: (text: string) => void,
  label: string,
  fileSize: number
): (e: { loaded: number; total?: number }) => void {
  let lastPct = -1;
  return (e) => {
    const total = e.total || fileSize;
    if (!total) return;
    const pct = Math.min(100, Math.round((e.loaded / total) * 100));
    if (pct === lastPct) return; // 避免高频重绘
    lastPct = pct;
    onText(`${label} ${pct}% (${formatSize(e.loaded)} / ${formatSize(total)})`);
  };
}

/** 将响应流写入文件（自动创建父目录），完成后返回绝对路径 */
export async function saveStream(
  stream: NodeJS.ReadableStream,
  outputPath: string
): Promise<string> {
  const abs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const writer = fs.createWriteStream(abs);
  stream.pipe(writer);
  await new Promise<void>((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
    stream.on('error', reject);
  });
  return abs;
}

/**
 * 从 Content-Disposition 解析文件名，支持 RFC 5987 的 filename*=UTF-8''<encoded>
 * （后端中文文件名走该编码）。解析失败时回退到 fallback。
 */
export function filenameFromDisposition(
  header: string | undefined,
  fallback: string
): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* 解析失败走下方回退 */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  if (plain?.[1]) return plain[1].trim();
  return fallback;
}
