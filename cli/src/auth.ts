import { getClient } from './client';
import { loadConfig, saveConfig } from './config';
import * as readline from 'readline';
import ora from 'ora';

export interface AuthProvider {
  /** 执行登录并返回 JWT */
  login(username?: string): Promise<string>;
}

/**
 * 交互式密码登录
 * MVP 实现：终端输入用户名 + 密码，调用 POST /api/auth/login
 */
export class PasswordAuthProvider implements AuthProvider {
  async login(username?: string): Promise<string> {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const hasRawMode = typeof stdin.setRawMode === 'function';

    let user: string;
    let password: string;

    if (username) {
      user = username;
    } else {
      user = await askQuestion('用户名: ');
    }

    // 输入密码
    if (hasRawMode) {
      // Unix / Git Bash：raw mode，逐字符读，回显 *
      password = await askPasswordRaw(stdin, stdout, '密码: ');
    } else {
      // Windows PowerShell / cmd：readline 行模式，明文
      password = await askPasswordLine('密码: ');
    }

    const spinner = ora('正在验证...').start();
    try {
      const client = getClient();
      const formData = new URLSearchParams();
      formData.append('username', user);
      formData.append('password', password);

      const res = await client.post('/api/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const token = res.data.access_token;
      const cfg = loadConfig();
      cfg.token = token;
      cfg.username = user;
      saveConfig(cfg);

      spinner.stop();
      return token;
    } catch (err) {
      spinner.stop();
      throw err;
    }
  }
}

function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Unix raw mode：逐字符读取，密码回显 * */
function askPasswordRaw(
  stdin: NodeJS.ReadStream & { fd: 0 },
  stdout: NodeJS.WriteStream,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    stdin.setRawMode(true);
    stdout.write(prompt);
    let pass = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(false);
          stdout.write('\n');
          resolve(pass);
          return;
        } else if (char === '\x7f' || char === '\b') {
          pass = pass.slice(0, -1);
        } else if (char === '\x03') {
          process.exit(1);
        } else {
          pass += char;
          stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Windows 非 TTY 回退：使用 process.stdin 直接监听 data 事件
 * 避免 readline.createInterface 关闭后无法再读 stdin 的问题
 */
function askPasswordLine(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  return new Promise((resolve) => {
    stdout.write(`(密码将明文显示) ${prompt}`);

    // 确保 stdin 处于 flowing 模式
    if (stdin.isPaused()) {
      stdin.resume();
    }

    const onData = (chunk: Buffer) => {
      const line = chunk.toString().trim();
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(line);
    };

    stdin.on('data', onData);
  });
}

/*
 * 未来扩展（架构预留）：
 *
 * export class BrowserAuthProvider implements AuthProvider {
 *   async login(): Promise<string> {
 *     // 打开浏览器 → 回调 localhost → 换取 JWT
 *   }
 * }
 */

export function logout(): void {
  const cfg = loadConfig();
  delete cfg.token;
  delete cfg.username;
  saveConfig(cfg);
}
