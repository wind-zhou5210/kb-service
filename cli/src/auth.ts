import { getClient } from './client';
import { loadConfig, saveConfig } from './config';
import * as readline from 'readline';
import ora from 'ora';

export interface AuthProvider {
  /** 执行登录并返回 JWT（password 缺省时交互式输入） */
  login(username?: string, password?: string): Promise<string>;
}

/**
 * 交互式密码登录
 * MVP 实现：终端输入用户名 + 密码，调用 POST /api/auth/login
 * 也支持预设密码（-p）用于脚本/CI 非交互场景
 */
export class PasswordAuthProvider implements AuthProvider {
  async login(username?: string, presetPassword?: string): Promise<string> {
    const stdin = process.stdin;
    const stdout = process.stdout;
    // Windows PowerShell 下 isTTY 可能为 true 但 raw mode 不工作
    const isWin = process.platform === 'win32';
    const useRaw = !isWin && Boolean(stdin.isTTY);

    let user: string;
    let password: string;

    if (presetPassword) {
      // 非交互：密码由调用方传入，用户名取参数或 KB_USERNAME
      user = username || process.env.KB_USERNAME || '';
      if (!user) {
        throw new Error('非交互登录需提供用户名: kb login <用户名> -p <密码>');
      }
      password = presetPassword;
    } else if (useRaw) {
      // Unix / Git Bash：readline 问用户名 + raw mode 输密码
      user = username || (await askQuestion('用户名: '));
      password = await askPasswordRaw(stdin, stdout, '密码: ');
    } else {
      // Windows：单个 readline 链式收集用户名+密码，避免 close 后 stdin 不可读
      const creds = await promptCredentialsWindows(username);
      user = creds.user;
      password = creds.password;
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
    stdin.resume(); // 恢复 readline.close() 导致的 pause
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
 * Windows 非 TTY 模式：强制 terminal: true 让 readline 正常工作
 */
function promptCredentialsWindows(
  presetUsername?: string
): Promise<{ user: string; password: string }> {
  return new Promise((resolve) => {
    // terminal: true 强制 readline 按终端模式处理
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let user = presetUsername || '';
    let step: 'user' | 'pass' = presetUsername ? 'pass' : 'user';

    rl.setPrompt(step === 'user' ? '用户名: ' : '密码: ');
    rl.prompt();

    rl.on('line', (line) => {
      const val = line.trim();
      if (step === 'user') {
        user = val;
        step = 'pass';
        rl.setPrompt('密码: ');
        rl.prompt();
      } else {
        rl.close();
        resolve({ user, password: val });
      }
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
