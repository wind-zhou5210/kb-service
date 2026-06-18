import { Command } from 'commander';
import { PasswordAuthProvider, logout } from '../auth';
import { loadConfig } from '../config';
import { printSuccess, printError, printKeyValue } from '../utils/table';
import { resetClient } from '../client';
import ora from 'ora';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('登录 kb-service')
    .option('-u, --username <user>', '用户名')
    .action(async (options) => {
      const spinner = ora('正在登录...').start();
      try {
        const provider = new PasswordAuthProvider();
        await provider.login(options.username);
        spinner.succeed('登录成功');
        const cfg = loadConfig();
        printSuccess(`当前用户: ${cfg.username}  |  服务端: ${cfg.server}`);
      } catch (err: any) {
        spinner.fail(err.message || '登录失败');
        process.exit(1);
      }
    });

  program
    .command('logout')
    .description('退出登录')
    .action(() => {
      logout();
      resetClient();
      printSuccess('已退出登录');
    });

  program
    .command('whoami')
    .description('查看当前用户')
    .action(() => {
      const cfg = loadConfig();
      if (!cfg.username || !cfg.token) {
        printError('未登录，请先执行: kb login');
        process.exit(1);
      }
      printKeyValue([
        ['用户名', cfg.username],
        ['服务端', cfg.server || '(未配置)'],
      ]);
    });
}
