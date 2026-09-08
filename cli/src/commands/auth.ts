import { Command } from 'commander';
import { PasswordAuthProvider, logout } from '../auth';
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
    .description('登录 kb-service，获取访问凭据（需先配置服务地址）')
    .argument('[username]', '管理员用户名，不传则交互式输入')
    .option('-u, --username <user>', '用户名（同位置参数）')
    .option(
      '-p, --password <pwd>',
      '密码（非交互登录，适合脚本；CI 场景更推荐 KB_TOKEN 环境变量）'
    )
    .addHelpText(
      'after',
      `
示例:
  $ kb login                       交互式输入用户名与密码
  $ kb login admin                 交互输入密码
  $ kb login admin -p secret       非交互登录（脚本）

CI/CD 免登录方式（不落盘凭据）:
  $ export KB_SERVER=https://kb.example.com
  $ export KB_TOKEN=<jwt>          可由 kb config set token 之外的渠道注入`
    )
    .action(async (usernameArg: string | undefined, options) => {
      try {
        const provider = new PasswordAuthProvider();
        await provider.login(usernameArg || options.username, options.password);
        const cfg = loadConfig();
        printSuccess(
          `登录成功！当前用户: ${cfg.username}  |  服务端: ${cfg.server}`
        );
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
