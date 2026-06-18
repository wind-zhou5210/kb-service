import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config';
import { printKeyValue, printSuccess, printError } from '../utils/table';

export function registerConfigCommands(program: Command): void {
  const cfg = program.command('config').description('管理 CLI 配置');

  cfg
    .command('set')
    .description('设置配置项')
    .argument('<key>', '配置项名称 (server)')
    .argument('<value>', '配置项值')
    .action((key: string, value: string) => {
      if (key !== 'server') {
        printError(`不支持的配置项: ${key}，目前仅支持 server`);
        process.exit(1);
      }
      const config = loadConfig();
      config.server = value.replace(/\/$/, '');
      saveConfig(config);
      printSuccess(`已设置 server = ${config.server}`);
    });

  cfg
    .command('get')
    .description('查看当前配置')
    .action(() => {
      const config = loadConfig();
      const pairs: [string, string][] = [
        ['server', config.server || '(未配置)'],
        ['username', config.username || '(未登录)'],
        ['token', config.token ? '***已保存***' : '(未登录)'],
        ['config_path', '~/.kbconfig.json'],
      ];
      printKeyValue(pairs);
    });
}
