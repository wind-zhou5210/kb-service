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
    const user = username || (await askQuestion('用户名: '));
    const password = await askPassword('密码: ');

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

function askPassword(prompt: string): Promise<string> {
  const stdout = process.stdout;
  const stdin = process.stdin;
  const hasRawMode = typeof stdin.setRawMode === 'function';

  // 如果支持 raw mode（Unix/Mac/Git Bash），逐字符读取并回显 *
  if (hasRawMode) {
    return new Promise((resolve) => {
      stdin.setRawMode(true);
      stdout.write(prompt);
      let pass = '';
      const onData = (chunk: Buffer) => {
        const str = chunk.toString();
        for (const char of str) {
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

  // Windows PowerShell/cmd：不支持 raw mode，使用行缓冲（密码明文可见）
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(`(密码将在终端明文显示) ${prompt}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
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
