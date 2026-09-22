import * as crypto from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import { getClient } from './client';
import { loadConfig, saveConfig } from './config';
import { AuthProvider } from './auth';
import { openBrowser } from './utils/open-browser';

/** 等待用户完成浏览器登录的最长时间 */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface BrowserAuthOptions {
  /** 只打印授权链接，不自动打开浏览器（本机无图形环境时使用） */
  printUrlOnly?: boolean;
  /** 回调等待超时（毫秒） */
  timeoutMs?: number;
  /** 授权链接打印完成后的回调（调用方据此启动等待提示，避免与链接输出交错） */
  onAuthUrl?: () => void;
}

/**
 * 浏览器授权登录：OAuth 授权码 + PKCE + 本机回环回调。
 *
 * 1. 生成 code_verifier / code_challenge / state
 * 2. 在 127.0.0.1 的随机端口启动回调服务器
 * 3. 打开服务端登录页（地址取自 KB_SERVER 配置），用户在页面上登录
 * 4. 浏览器登录后跳回本机回调地址并携带一次性授权码
 * 5. 用 code + code_verifier 换取 JWT 并保存到 ~/.kbconfig.json
 */
export class BrowserAuthProvider implements AuthProvider {
  constructor(private readonly options: BrowserAuthOptions = {}) {}

  async login(): Promise<string> {
    const config = loadConfig();
    if (!config.server) {
      throw new Error('未配置服务端地址，请先执行: kb config set server <url>');
    }

    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64Url(crypto.randomBytes(16));

    const server = http.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    }).catch((err: Error) => {
      throw new Error(
        `无法在本机启动回调端口（${err.message}），请改用: kb login --print-url`
      );
    });

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl =
      `${config.server}/login?cli_callback=1` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&state=${encodeURIComponent(state)}` +
      `&client=kb-cli`;

    // 先建立回调监听（waitForCode 的 Promise executor 同步执行），再打开浏览器，
    // 避免"浏览器已打开但监听尚未注册"的理论竞态
    const codePromise = this.waitForCode(
      server,
      state,
      redirectUri,
      this.options.timeoutMs
    );

    console.log('\n请在浏览器中完成登录：');
    console.log(`  ${authUrl}\n`);
    // 提示与打开浏览器失败不应中断授权流程（链接已打印，用户可手动访问），
    // 同时避免回调抛错导致 finally 中的 server.close() 被跳过
    try {
      this.options.onAuthUrl?.();
      if (!this.options.printUrlOnly) {
        openBrowser(authUrl);
      }
    } catch {
      /* 忽略：用户可复制上方链接手动打开 */
    }

    try {
      const code = await codePromise;
      const client = getClient();
      const res = await client.post('/api/auth/cli/token', {
        code,
        code_verifier: verifier,
      });

      const token: string = res.data.access_token;
      const username: string = res.data.username || config.username || 'admin';
      const latest = loadConfig();
      latest.token = token;
      latest.username = username;
      saveConfig(latest);
      return token;
    } finally {
      server.close();
    }
  }

  /**
   * 等待浏览器回调并取出授权码。
   * state 不匹配的回调不会结束等待（防伪造回调），仅返回错误页。
   */
  private waitForCode(
    server: http.Server,
    expectedState: string,
    redirectUri: string,
    timeoutMs = CALLBACK_TIMEOUT_MS
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const finish = (error: Error | null, code?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.removeListener('request', onRequest);
        if (error) reject(error);
        else resolve(code as string);
      };

      const timer = setTimeout(() => {
        const label =
          timeoutMs >= 60_000
            ? `${Math.round(timeoutMs / 60_000)} 分钟`
            : `${Math.round(timeoutMs / 1000)} 秒`;
        finish(new Error(`授权超时（${label}），请重新执行 kb login`));
      }, timeoutMs);

      const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        // 畸形请求（如 "GET http:// HTTP/1.1"）会让 new URL 抛错。异常发生在
        // HTTP 事件回调中，会绕过 login() 的 try/finally 直接崩溃进程，
        // 故必须就地捕获：拒绝该请求，但不结束等待（与 state 不符的处理一致）
        let url: URL;
        try {
          url = new URL(req.url || '/', redirectUri);
        } catch {
          res
            .writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
            .end('Bad Request');
          return;
        }
        if (url.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
          return;
        }

        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        if (state !== expectedState) {
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end('<h3>回调校验失败</h3><p>请返回终端重试。</p>');
          return;
        }
        if (!code) {
          res
            .writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            .end('<h3>未收到授权码</h3><p>请返回终端重试。</p>');
          return;
        }

        res
          .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          .end('<h3>登录成功</h3><p>请返回终端，kb 正在完成登录。</p>');
        finish(null, code);
      };

      server.on('request', onRequest);
    });
  }
}
