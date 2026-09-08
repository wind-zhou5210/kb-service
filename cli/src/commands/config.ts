import { Command } from 'commander';
import { loadConfig, loadFileConfig, saveConfig, getConfigPath } from '../config';
import { printKeyValue, printSuccess, printError } from '../utils/table';

const ALLOWED_KEYS = ['server', 'token', 'username'];

/** 标记配置项当前值的来源（环境变量覆盖时提示，便于排查 CI 场景） */
function withSource(value: string, envKey: string, masked = false): string {
  const shown = masked ? '***已保存***' : value;
  return process.env[envKey] ? `${shown}  (来自 ${envKey})` : shown;
}

export function registerConfigCommands(program: Command): void {
  const cfg = program
    .command('config')
    .description('管理 CLI 配置（server / token / username）')
    .addHelpText(
      'after',
      `
示例:
  $ kb config set server https://kb.example.com
  $ kb config set token <jwt>        直接注入令牌（免交互登录）
  $ kb config get                    查看当前配置与来源
  $ kb config unset token            清除已保存令牌

环境变量（优先于配置文件，适合 CI/CD）:
  KB_SERVER   服务端地址
  KB_TOKEN    访问令牌
  KB_USERNAME 用户名`
    );

  cfg
    .command('set')
    .description('设置配置项')
    .argument('<key>', `配置项名称 (${ALLOWED_KEYS.join(' / ')})`)
    .argument('<value>', '配置项值')
    .action((key: string, value: string) => {
      if (!ALLOWED_KEYS.includes(key)) {
        printError(`不支持的配置项: ${key}，支持: ${ALLOWED_KEYS.join(' / ')}`);
        process.exit(1);
      }
      const config = loadFileConfig();
      if (key === 'server') {
        config.server = value.replace(/\/$/, '');
      } else if (key === 'token') {
        config.token = value;
      } else {
        config.username = value;
      }
      saveConfig(config);
      printSuccess(
        `已设置 ${key} = ${key === 'token' ? '***已保存***' : (config as any)[key]}`
      );
    });

  cfg
    .command('unset')
    .description('清除配置项（token / username）')
    .argument('<key>', `配置项名称 (${ALLOWED_KEYS.filter((k) => k !== 'server').join(' / ')})`)
    .action((key: string) => {
      if (key !== 'token' && key !== 'username') {
        printError(`不支持清除的配置项: ${key}，支持: token / username`);
        process.exit(1);
      }
      const config = loadFileConfig();
      delete (config as any)[key];
      saveConfig(config);
      printSuccess(`已清除 ${key}`);
    });

  cfg
    .command('get')
    .description('查看当前配置')
    .action(() => {
      const merged = loadConfig();
      const pairs: [string, string][] = [
        [
          'server',
          merged.server ? withSource(merged.server, 'KB_SERVER') : '(未配置)',
        ],
        [
          'username',
          merged.username ? withSource(merged.username, 'KB_USERNAME') : '(未登录)',
        ],
        ['token', merged.token ? withSource(merged.token, 'KB_TOKEN', true) : '(未登录)'],
        ['config_path', getConfigPath()],
      ];
      printKeyValue(pairs);
      if (!merged.server) {
        printError('未配置服务端地址，请先执行: kb config set server <url>');
      }
    });
}
