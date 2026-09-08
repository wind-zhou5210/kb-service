import { Command } from 'commander';
import { getClient } from '../client';
import { printSuccess, printTable, printError } from '../utils/table';
import { askConfirm } from '../utils/prompt';
import { loadConfig } from '../config';
import type { Collection, DocumentItem, Workspace } from '../types';
import ora from 'ora';

/** 前端路由前缀：集合 / 单文档 / 工作空间三类分享页 */
function shareUrls() {
  const cfg = loadConfig();
  return {
    collection: (token: string) => `${cfg.server}/share/${token}`,
    document: (token: string) => `${cfg.server}/share/doc/${token}`,
    workspace: (token: string, file?: string) =>
      `${cfg.server}/share/workspace/${token}${file ? `?file=${encodeURIComponent(file)}` : ''}`,
  };
}

function output(token: string, url: string, json: boolean, extra?: Record<string, any>) {
  if (json) {
    console.log(JSON.stringify({ share_token: token, url, ...extra }, null, 2));
  } else {
    printSuccess('分享链接: ' + url);
  }
}

export function registerShareCommands(program: Command): void {
  const share = program
    .command('share')
    .description('管理分享链接 — 生成/撤销只读访问链接，查看已分享清单')
    .addHelpText(
      'after',
      `
示例:
  $ kb share collection 1              生成集合分享链接
  $ kb share document 5                生成文档分享链接
  $ kb share workspace 2               生成工作空间分享链接
  $ kb share workspace 2 -f todo.html  生成直达 todo.html 的链接（文件级锚点）
  $ kb share list                      查看当前所有已分享的对象
  $ kb share revoke document 5         撤销文档分享（原链接立即失效）
  $ kb share revoke workspace 2 -y     撤销工作空间分享并跳过确认`
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
        output(data.share_token, shareUrls().collection(data.share_token), options.json);
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
        output(data.share_token, shareUrls().document(data.share_token), options.json);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  share
    .command('workspace')
    .description('生成工作空间只读分享链接（可精确到某个文件）')
    .argument('<id>', '工作空间 ID')
    .option('-f, --file <path>', '生成直达该文件的链接（分享页 ?file= 深链）')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('生成分享链接...').start();
      try {
        const client = getClient();
        const { data } = await client.post<{ share_token: string }>(
          `/api/workspaces/${id}/share`
        );
        spinner.stop();
        const url = shareUrls().workspace(data.share_token, options.file);
        output(data.share_token, url, options.json, { file: options.file || null });
        if (!options.json && options.file) {
          console.log(`  ↳ 打开后直达文件: ${options.file}`);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  share
    .command('list')
    .description('列出当前所有已分享的对象（集合 / 文档 / 工作空间）')
    .option('--json', 'JSON 格式输出')
    .action(async (options) => {
      const spinner = ora('汇总分享清单...').start();
      try {
        const client = getClient();
        const urls = shareUrls();
        const rows: string[][] = [];

        const [{ data: cols }, { data: workspaces }] = await Promise.all([
          client.get<Collection[]>('/api/collections'),
          client.get<Workspace[]>('/api/workspaces'),
        ]);

        for (const c of cols) {
          if (c.share_token) {
            rows.push(['集合', String(c.id), c.name, urls.collection(c.share_token)]);
          }
        }
        for (const w of workspaces) {
          if (w.share_token) {
            rows.push([
              '工作空间',
              String(w.id),
              w.name,
              urls.workspace(w.share_token),
            ]);
          }
        }
        // 文档分享需逐集合遍历（后端无全局分享清单端点）
        for (const c of cols) {
          const { data: docs } = await client.get<DocumentItem[]>(
            `/api/collections/${c.id}/documents`
          );
          for (const d of docs) {
            if (d.share_token) {
              rows.push([
                '文档',
                String(d.id),
                `${d.title}（${c.name}）`,
                urls.document(d.share_token),
              ]);
            }
          }
        }

        spinner.stop();
        if (!rows.length) {
          console.log('当前没有任何已分享的对象');
          return;
        }
        printTable(['类型', 'ID', '名称', '分享链接'], rows, { json: options.json });
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ revoke 子命令组 ------
  const revoke = share
    .command('revoke')
    .description('撤销分享链接（原链接立即失效）')
    .addHelpText(
      'after',
      `
示例:
  $ kb share revoke collection 1
  $ kb share revoke document 5 -y
  $ kb share revoke workspace 2`
    );

  const revokeTargets: Array<{
    name: string;
    label: string;
    path: (id: string) => string;
  }> = [
    { name: 'collection', label: '集合', path: (id) => `/api/collections/${id}/share` },
    { name: 'document', label: '文档', path: (id) => `/api/documents/${id}/share` },
    { name: 'workspace', label: '工作空间', path: (id) => `/api/workspaces/${id}/share` },
  ];

  for (const t of revokeTargets) {
    revoke
      .command(t.name)
      .description(`撤销${t.label}分享链接`)
      .argument('<id>', `${t.label} ID`)
      .option('-y, --yes', '跳过确认')
      .action(async (id: string, options) => {
        try {
          if (!options.yes) {
            const ok = await askConfirm(
              `确认撤销${t.label} ${id} 的分享链接? 已发出的链接将立即失效 (y/N) `
            );
            if (!ok) {
              console.log('已取消');
              return;
            }
          }
          const spinner = ora('撤销中...').start();
          try {
            const client = getClient();
            await client.delete(t.path(id));
            spinner.succeed(`${t.label}分享已撤销`);
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
}
