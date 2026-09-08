import { Command } from 'commander';
import { getClient } from '../client';
import { printTable, printError, printKeyValue } from '../utils/table';
import { formatTime, truncate } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import type { Collection } from '../types';
import ora from 'ora';

export function registerCollectionCommands(program: Command): void {
  const col = program
    .command('collection')
    .alias('col')
    .description('管理知识集合（新建、列表、详情、修改、删除）')
    .addHelpText(
      'after',
      `
示例:
  $ kb collection list              列表查看全部集合
  $ kb collection get 1             查看集合详情（含分享状态）
  $ kb collection create "我的文档"  创建新集合
  $ kb collection create "技术" -d "技术文档归档"
  $ kb collection update 1 --name "新名称" --desc "新描述"
  $ kb collection update 1 --sort 3  调整集合排序
  $ kb collection delete 1          删除集合（需确认）
  $ kb collection delete 1 -y       删除集合（跳过确认）
  $ kb col list                     简写形式

相关命令:
  $ kb download --all -c 1 -o ./out  批量下载集合内全部文档
  $ kb share collection 1            生成集合分享链接
  $ kb share revoke collection 1     撤销集合分享`
    );

  col
    .command('list')
    .description('列出全部集合（含文档数量与分享状态）')
    .option('--json', 'JSON 格式输出')
    .action(async (options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<Collection[]>('/api/collections');
        spinner.stop();
        if (!data.length) {
          console.log('暂无集合，可用 kb collection create <名称> 新建');
          return;
        }
        const rows = data.map((c) => [
          String(c.id),
          truncate(c.name, 30),
          truncate(c.description || '-', 32),
          String(c.doc_count),
          String(c.sort_order ?? 0),
          c.share_token ? '已分享' : '-',
          formatTime(c.updated_at || c.created_at),
        ]);
        printTable(
          ['ID', '名称', '描述', '文档数', '排序', '分享', '更新时间'],
          rows,
          { json: options.json }
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  col
    .command('get')
    .description('查看集合详情')
    .argument('<id>', '集合 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        // 后端无单个集合详情端点：从列表接口取对应项
        const { data } = await client.get<Collection[]>('/api/collections');
        const target = data.find((c) => String(c.id) === String(id));
        spinner.stop();
        if (!target) {
          printError(`集合不存在: ${id}`);
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(target, null, 2));
          return;
        }
        printKeyValue([
          ['ID', String(target.id)],
          ['名称', target.name],
          ['描述', target.description || '-'],
          ['封面', target.cover || '-'],
          ['文档数', String(target.doc_count)],
          ['排序', String(target.sort_order ?? 0)],
          ['分享令牌', target.share_token || '(未分享)'],
          ['创建时间', formatTime(target.created_at)],
          ['更新时间', formatTime(target.updated_at)],
        ]);
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
    .command('update')
    .description('修改集合名称/描述/封面/排序')
    .argument('<id>', '集合 ID')
    .option('--name <name>', '新名称')
    .option('--desc <desc>', '新描述')
    .option('--cover <cover>', '封面标识')
    .option('--sort <order>', '排序值（整数，越小越靠前）')
    .addHelpText(
      'after',
      '\n示例:\n  $ kb collection update 1 --name "产品知识库"\n  $ kb collection update 1 --desc "归档产品文档" --sort 2'
    )
    .action(async (id: string, options) => {
      const hasUpdate =
        options.name ||
        options.desc !== undefined ||
        options.cover !== undefined ||
        options.sort !== undefined;
      if (!hasUpdate) {
        printError('请至少指定一个更新项: --name / --desc / --cover / --sort');
        process.exit(1);
      }
      const spinner = ora('更新中...').start();
      try {
        const client = getClient();
        const body: Record<string, any> = {};
        if (options.name) body.name = options.name;
        if (options.desc !== undefined) body.description = options.desc;
        if (options.cover !== undefined) body.cover = options.cover;
        if (options.sort !== undefined) {
          const n = Number(options.sort);
          if (!Number.isInteger(n)) {
            spinner.fail('--sort 需为整数');
            process.exit(1);
          }
          body.sort_order = n;
        }
        const { data } = await client.patch<Collection>(`/api/collections/${id}`, body);
        spinner.succeed('集合已更新');
        printKeyValue([
          ['ID', String(data.id)],
          ['名称', data.name],
          ['描述', data.description || '-'],
          ['排序', String(data.sort_order ?? 0)],
        ]);
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
