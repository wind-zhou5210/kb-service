import { Command } from 'commander';
import { getClient } from '../client';
import { printSuccess } from '../utils/table';
import { loadConfig } from '../config';
import ora from 'ora';

export function registerShareCommands(program: Command): void {
  const share = program
    .command('share')
    .description('管理分享链接 — 生成只读访问链接')
    .addHelpText(
      'after',
      `
示例:
  $ kb share collection 1          生成集合分享链接
  $ kb share collection 1 --json   以 JSON 格式输出分享信息
  $ kb share document 5            生成文档分享链接`
    );

  share
    .command('collection')
    .description('为指定集合生成只读分享链接')
    .argument('<id>', '集合 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('生成分享链接...').start();
      try {
        const client = getClient();
        const { data } = await client.post<{ share_token: string }>(
          `/api/collections/${id}/share`
        );
        spinner.stop();
        const cfg = loadConfig();
        const url = `${cfg.server}/share/${data.share_token}`;
        if (options.json) {
          console.log(JSON.stringify({ share_token: data.share_token, url }));
        } else {
          printSuccess('分享链接: ' + url);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  share
    .command('document')
    .description('生成/查看文档分享链接')
    .argument('<id>', '文档 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('生成分享链接...').start();
      try {
        const client = getClient();
        const { data } = await client.post<{ share_token: string }>(
          `/api/documents/${id}/share`
        );
        spinner.stop();
        const cfg = loadConfig();
        const url = `${cfg.server}/share/doc/${data.share_token}`;
        if (options.json) {
          console.log(JSON.stringify({ share_token: data.share_token, url }));
        } else {
          printSuccess('分享链接: ' + url);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });
}
