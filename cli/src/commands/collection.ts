import { Command } from 'commander';
import { getClient } from '../client';
import { printTable, printError } from '../utils/table';
import { formatTime, truncate } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import type { Collection } from '../types';
import ora from 'ora';

export function registerCollectionCommands(program: Command): void {
  const col = program
    .command('collection')
    .alias('col')
    .description('管理知识集合（新建、列表、删除）')
    .addHelpText(
      'after',
      `
示例:
  $ kb collection list              列表查看全部集合
  $ kb collection create "我的文档"  创建新集合
  $ kb collection create "技术" -d "技术文档归档"
  $ kb collection delete 1          删除集合（需确认）
  $ kb collection delete 1 -y       删除集合（跳过确认）
  $ kb col list                     简写形式`
    );

  col
    .command('list')
    .description('列出全部集合（含文档数量）')
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
    .description('创建新集合')
    .argument('<name>', '集合名称')
    .option('-d, --desc <desc>', '集合描述（可选）')
    .addHelpText('after', '\n示例:\n  $ kb collection create "技术文档"\n  $ kb collection create "项目X" -d "X项目知识归档"')
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
