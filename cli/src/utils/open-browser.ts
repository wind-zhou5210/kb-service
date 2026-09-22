import { spawn } from 'child_process';

/**
 * 用系统默认浏览器打开链接。
 * 失败时静默忽略：无图形环境（如纯 SSH 会话）由调用方打印链接兜底。
 *
 * 用 spawn + 参数数组而非 exec，避免外层 shell 再次拼接命令；
 * detached + unref 让子进程不阻塞 CLI 退出。
 * 注意 Windows 分支仍经 cmd 解析（start 是 cmd 内置命令），
 * 需对 & 转义，原因见函数内注释。
 */
export function openBrowser(url: string): void {
  const isWindows = process.platform === 'win32';
  // Windows 的 start 是 cmd 内置命令，须经 cmd /c 调用；空串为窗口标题占位。
  // 授权链接含 & （多个查询参数），而 Node 经 libuv 传参时对不含空格/引号的参数
  // 不会自动加引号，cmd 会把 & 当作命令分隔符截断 URL —— 故按 cmd 规则转义为 ^&。
  const command = process.platform === 'darwin' ? 'open' : isWindows ? 'cmd' : 'xdg-open';
  const target = isWindows ? url.replace(/&/g, '^&') : url;
  const args = isWindows ? ['/c', 'start', '', target] : [target];

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* 忽略：用户可手动复制链接访问 */
    });
    child.unref();
  } catch {
    /* 忽略：无图形环境等 */
  }
}
