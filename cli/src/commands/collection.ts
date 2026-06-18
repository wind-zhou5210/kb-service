import { Command } from 'commander';
import { getClient } from '../client';
import { printTable, printError } from '../utils/table';
import { formatTime, truncate } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import type { Collection } from '../types';
import ora from 'ora';

export function registerCollectionCommands(program: Command): void {
  const col = program.command('collection').alias('col').description('管理知识集合');

  col
    .command('list')
    .description('列出全部集合')
    .option('--json', 'JSON 格式输出')
    .action(async (options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<Collection[]>('/api/collections');
        spinner.stop();
        const rows = data.map((c) => [
          String(c.id),
          truncate(c.name, 30),
          truncate(c.description || '-', 40),
          String(c.doc_count),
          formatTime(c.updated_at || c.created_at),
        ]);
        printTable(['ID', '名称', '描述', '文档数', '更新时间'], rows, { json: options.json });
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  col
    .command('create')
    .description('创建集合')
    .argument('<name>', '集合名称')
    .option('-d, --desc <desc>', '集合描述')
    .action(async (name: string, options) => {
      const spinner = ora('创建中...').start();
      try {
        const client = getClient();
        const { data } = await client.post('/api/collections', { name, description: options.desc });
        spinner.succeed('集合已创建');
        printTable(
          ['ID', '名称', '描述'],
          [[String(data.id), data.name, data.description || '-']]
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  col
    .command('delete')
    .description('删除集合（级联删除文档）')
    .argument('<id>', '集合 ID')
    .option('-y, --yes', '跳过确认')
    .action(async (id: string, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(`确认删除集合 ID=${id} 及其所有文档? (y/N) `);
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('删除中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/collections/${id}`);
          spinner.succeed('集合已删除');
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });
}
