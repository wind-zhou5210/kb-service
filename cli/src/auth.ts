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

    if (hasRawMode) {
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
 * Windows 非 TTY 回退：单个 readline 实例链式收集用户名和密码
 * 避免 readline.close() 后 stdin 不可读的问题
 */
function promptCredentialsWindows(
  presetUsername?: string
): Promise<{ user: string; password: string }> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askPass = (user: string) => {
      rl.question('密码: ', (pass) => {
        rl.close();
        resolve({ user, password: pass.trim() });
      });
    };

    if (presetUsername) {
      askPass(presetUsername);
    } else {
      rl.question('用户名: ', (user) => {
        askPass(user.trim());
      });
    }
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
