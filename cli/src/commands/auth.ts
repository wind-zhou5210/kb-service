import { Command } from 'commander';
import ora from 'ora';
import { PasswordAuthProvider, logout } from '../auth';
import { BrowserAuthProvider } from '../browser-auth';
import { loadConfig } from '../config';
import {
  printSuccess,
  printError,
  printWarning,
  printKeyValue,
} from '../utils/table';
import { resetClient, getClient } from '../client';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('登录 kb-service（默认打开浏览器授权；带用户名或 -p 时走密码登录）')
    .argument('[username]', '管理员用户名；传入则走密码登录')
    .option('-u, --username <user>', '用户名（同位置参数）')
    .option(
      '-p, --password <pwd>',
      '密码（非交互登录，适合脚本；CI 场景更推荐 KB_TOKEN 环境变量）'
    )
    .option('--print-url', '仅打印授权链接，不自动打开浏览器')
    .addHelpText(
      'after',
      `
示例:
  $ kb login                       打开浏览器完成授权（推荐）
  $ kb login --print-url           只打印授权链接，手动在浏览器打开
  $ kb login admin -p secret       密码登录（脚本/CI）
  $ kb login admin                 交互式输入密码

浏览器授权说明:
  命令会在本机 127.0.0.1 的随机端口临时启动回调服务，并在浏览器打开本服务的
  登录页；登录完成后浏览器自动跳回本机完成授权，令牌只保存在你本机。

CI/CD 免登录方式（不落盘凭据）:
  $ export KB_SERVER=https://kb.example.com
  $ export KB_TOKEN=<jwt>`
    )
    .action(async (usernameArg: string | undefined, options) => {
      try {
        const usePassword =
          Boolean(options.password) || Boolean(usernameArg) || Boolean(options.username);

        if (usePassword) {
          const provider = new PasswordAuthProvider();
          await provider.login(usernameArg || options.username, options.password);
        } else {
          // spinner 在授权链接打印后再启动，避免与链接输出交错
          const spinner = ora('等待浏览器完成授权...');
          const provider = new BrowserAuthProvider({
            printUrlOnly: options.printUrl,
            onAuthUrl: () => spinner.start(),
          });
          try {
            await provider.login();
          } finally {
            spinner.stop();
          }
        }

        const cfg = loadConfig();
        printSuccess(`登录成功！当前用户: ${cfg.username}  |  服务端: ${cfg.server}`);
      } catch (err: any) {
        printError(err.message || '登录失败');
        process.exit(1);
      }
    });

  program
    .command('logout')
    .description('退出登录（清除本地保存的令牌）')
    .action(() => {
      logout();
      resetClient();
      printSuccess('已退出登录');
      if (process.env.KB_TOKEN) {
        printWarning('检测到环境变量 KB_TOKEN 仍在生效，需 unset 后才彻底退出');
      }
    });

  program
    .command('whoami')
    .description('查看当前用户并校验令牌是否有效')
    .action(async () => {
      const cfg = loadConfig();
      if (!cfg.username || !cfg.token) {
        printError('未登录，请先执行: kb login');
        process.exit(1);
      }
      printKeyValue([
        ['用户名', cfg.username],
        ['服务端', cfg.server || '(未配置)'],
      ]);
      // 令牌有效性校验：调用需鉴权端点，过期会得到 401 并被拦截器转为可读错误
      try {
        await getClient().get('/api/workspaces');
        printSuccess('令牌有效');
      } catch (err: any) {
        printWarning(`令牌校验失败: ${err.message}`);
        process.exit(1);
      }
    });
}
