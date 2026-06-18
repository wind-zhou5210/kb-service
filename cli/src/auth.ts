import { getClient } from './client';
import { loadConfig, saveConfig } from './config';
import * as readline from 'readline';

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
    const user = username || (await askQuestion('用户名: '));
    const password = await askPassword('密码: ');

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

    return token;
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

function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdout.write(prompt);
    let pass = '';
    const onData = (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === '\r' || char === '\n') {
        stdin.removeListener('data', onData);
        if (typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(false);
        }
        stdout.write('\n');
        resolve(pass);
      } else if (char === '\x7f' || char === '\b') {
        pass = pass.slice(0, -1);
      } else if (char === '\x03') {
        process.exit(1);
      } else {
        pass += char;
        stdout.write('*');
      }
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
