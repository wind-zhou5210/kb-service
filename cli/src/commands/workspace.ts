import { Command } from 'commander';
import { getClient } from '../client';
import {
  printTable,
  printError,
  printWarning,
  printSuccess,
  printKeyValue,
} from '../utils/table';
import { formatSize, formatTime, truncate } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import { uploadProgress, saveStream, filenameFromDisposition } from '../utils/upload';
import { checkSizeLimit, WORKSPACE_ZIP_MAX_MB } from '../utils/limits';
import { loadConfig } from '../config';
import type { Workspace, WorkspaceTreeNode, WorkspaceFileResult } from '../types';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

/** 展平目录树，得到全部文件的相对路径 */
function flattenTree(nodes: WorkspaceTreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'directory') {
      flattenTree(n.children || [], out);
    } else if (n.path) {
      out.push(n.path);
    }
  }
  return out;
}

/** 树形渲染（├─ └─ 缩进），目录带尾部斜杠 */
function renderTree(nodes: WorkspaceTreeNode[], prefix = '', out: string[] = []): string[] {
  nodes.forEach((n, i) => {
    const isLast = i === nodes.length - 1;
    const branch = isLast ? '└─ ' : '├─ ';
    if (n.type === 'directory') {
      out.push(`${prefix}${branch}${n.name}/`);
      renderTree(n.children || [], prefix + (isLast ? '   ' : '│  '), out);
    } else {
      out.push(`${prefix}${branch}${n.name}`);
    }
  });
  return out;
}

/** 分享页 URL 前缀（与前端路由一致） */
function shareBase(): string {
  const cfg = loadConfig();
  return `${cfg.server}/share/workspace`;
}

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command('workspace')
    .alias('ws')
    .description('管理工作空间（原型/多文件目录：上传、浏览、下载、分享）')
    .addHelpText(
      'after',
      `
示例:
  $ kb workspace list                     列出全部工作空间
  $ kb workspace create "产品原型"         新建工作空间
  $ kb workspace tree 1                   查看目录树
  $ kb workspace tree 1 --filter todo     按关键词过滤文件路径
  $ kb workspace upload 1 ./dist.zip      zip 全量替换（清空后重建）
  $ kb workspace push 1 ./todo.html -p pages/todo.html
  $ kb workspace cat 1 todo.html          终端输出文件内容
  $ kb workspace download 1 -o ./out      整包下载
  $ kb workspace share 1 --file todo.html 生成直达该文件的分享链接
  $ kb ws list                            简写形式`
    );

  // ------ list ------
  ws.command('list')
    .description('列出全部工作空间（含文件数与体积）')
    .option('--json', 'JSON 格式输出')
    .action(async (options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<Workspace[]>('/api/workspaces');
        spinner.stop();
        if (!data.length) {
          console.log('暂无工作空间，可用 kb workspace create <名称> 新建');
          return;
        }
        const rows = data.map((w) => [
          String(w.id),
          truncate(w.name, 24),
          truncate(w.description || '-', 30),
          String(w.file_count ?? 0),
          formatSize(w.total_size ?? 0),
          w.share_token ? '已分享' : '-',
          formatTime(w.updated_at || w.created_at),
        ]);
        printTable(
          ['ID', '名称', '描述', '文件数', '体积', '分享', '更新时间'],
          rows,
          { json: options.json }
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ create ------
  ws.command('create')
    .description('新建工作空间')
    .argument('<name>', '工作空间名称')
    .option('-d, --desc <desc>', '描述（可选）')
    .action(async (name: string, options) => {
      const spinner = ora('创建中...').start();
      try {
        const client = getClient();
        const { data } = await client.post<Workspace>('/api/workspaces', {
          name,
          description: options.desc,
        });
        spinner.succeed('工作空间已创建');
        printKeyValue([
          ['ID', String(data.id)],
          ['名称', data.name],
          ['描述', data.description || '-'],
        ]);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ get ------
  ws.command('get')
    .description('查看工作空间详情')
    .argument('<id>', '工作空间 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<Workspace>(`/api/workspaces/${id}`);
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        printKeyValue([
          ['ID', String(data.id)],
          ['名称', data.name],
          ['描述', data.description || '-'],
          ['文件数', String(data.file_count ?? 0)],
          ['总体积', formatSize(data.total_size ?? 0)],
          ['存储路径', data.storage_path],
          ['分享', data.share_token ? `${shareBase()}/${data.share_token}` : '(未分享)'],
          ['创建时间', formatTime(data.created_at)],
          ['更新时间', formatTime(data.updated_at)],
        ]);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ update ------
  ws.command('update')
    .description('更新工作空间名称/描述')
    .argument('<id>', '工作空间 ID')
    .option('--name <name>', '新名称')
    .option('--desc <desc>', '新描述')
    .action(async (id: string, options) => {
      if (!options.name && !options.desc) {
        printError('请至少指定一个更新项: --name / --desc');
        process.exit(1);
      }
      const spinner = ora('更新中...').start();
      try {
        const client = getClient();
        const body: Record<string, any> = {};
        if (options.name) body.name = options.name;
        if (options.desc !== undefined) body.description = options.desc;
        const { data } = await client.patch<Workspace>(`/api/workspaces/${id}`, body);
        spinner.succeed('工作空间已更新');
        printKeyValue([
          ['ID', String(data.id)],
          ['名称', data.name],
          ['描述', data.description || '-'],
        ]);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ delete ------
  ws.command('delete')
    .description('删除工作空间（含全部磁盘文件，不可恢复）')
    .argument('<id>', '工作空间 ID')
    .option('-y, --yes', '跳过确认')
    .action(async (id: string, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(
            `确认删除工作空间 ID=${id} 及其全部文件? 该操作不可恢复 (y/N) `
          );
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('删除中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/workspaces/${id}`);
          spinner.succeed('工作空间已删除');
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // ------ tree ------
  ws.command('tree')
    .description('查看工作空间目录树')
    .argument('<id>', '工作空间 ID')
    .option('-f, --filter <keyword>', '按关键词过滤文件路径（输出扁平列表）')
    .option('--json', 'JSON 格式输出原始树结构')
    .action(async (id: string, options) => {
      const spinner = ora('加载目录树...').start();
      try {
        const client = getClient();
        const { data } = await client.get<WorkspaceTreeNode[]>(
          `/api/workspaces/${id}/tree`
        );
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const files = flattenTree(data);
        if (!files.length) {
          console.log('工作空间为空，可用 kb workspace upload <id> <zip> 上传');
          return;
        }
        if (options.filter) {
          const kw = String(options.filter).toLowerCase();
          const hits = files.filter((p) => p.toLowerCase().includes(kw));
          if (!hits.length) {
            console.log(`无匹配 "${options.filter}" 的文件（共 ${files.length} 个文件）`);
            return;
          }
          hits.forEach((p) => console.log(p));
          console.log(`\n共 ${hits.length} / ${files.length} 个文件匹配`);
          return;
        }
        console.log(renderTree(data).join('\n'));
        console.log(`\n共 ${files.length} 个文件`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ upload (zip 全量替换) ------
  ws.command('upload')
    .description('上传 zip 包到工作空间（全量替换：先清空目录再解压重建）')
    .argument('<id>', '工作空间 ID')
    .argument('<zip>', 'zip 包路径')
    .option('-y, --yes', '跳过确认（该操作会清空工作空间现有文件）')
    .action(async (id: string, zipPath: string, options) => {
      if (!fs.existsSync(zipPath) || !fs.statSync(zipPath).isFile()) {
        printError(`文件不存在: ${zipPath}`);
        process.exit(1);
      }
      if (!zipPath.toLowerCase().endsWith('.zip')) {
        printWarning('该文件不是 .zip，服务端会拒绝；请打包为 zip 后重试');
        process.exit(1);
      }
      const size = fs.statSync(zipPath).size;
      const oversize = checkSizeLimit(size, WORKSPACE_ZIP_MAX_MB, 'zip 包');
      if (oversize) {
        printError(oversize);
        process.exit(1);
      }
      try {
        if (!options.yes) {
          const ok = await askConfirm(
            `上传 ${path.basename(zipPath)} (${formatSize(size)}) 将【清空并替换】工作空间 ${id} 的全部文件，继续? (y/N) `
          );
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }

      const spinner = ora('上传中...').start();
      try {
        const client = getClient();
        const form = new FormData();
        form.append('file', fs.createReadStream(zipPath), path.basename(zipPath));
        const { data } = await client.post<{ count: number }>(
          `/api/workspaces/${id}/upload`,
          form,
          {
            headers: form.getHeaders(),
            timeout: 0, // 大包上传不设超时（实例默认 30s 对 500MB 不够）
            onUploadProgress: uploadProgress(
              (t) => (spinner.text = t),
              '上传中',
              size
            ),
          }
        );
        spinner.succeed(`上传完成：写入 ${data.count ?? 0} 个文件`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ push (单文件 upsert) ------
  ws.command('push')
    .description('上传/替换工作空间内的单个文件（增量，不影响其他文件）')
    .argument('<id>', '工作空间 ID')
    .argument('<file>', '本地文件路径')
    .option('-p, --path <path>', '工作空间内目标路径（默认用文件名）')
    .action(async (id: string, file: string, options) => {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        printError(`文件不存在: ${file}`);
        process.exit(1);
      }
      const target = options.path || path.basename(file);
      const size = fs.statSync(file).size;
      const oversize = checkSizeLimit(size, WORKSPACE_ZIP_MAX_MB, '文件');
      if (oversize) {
        printError(oversize);
        process.exit(1);
      }

      const spinner = ora(`上传 ${target} ...`).start();
      try {
        const client = getClient();
        const form = new FormData();
        form.append('file', fs.createReadStream(file), path.basename(file));
        const { data } = await client.post<WorkspaceFileResult>(
          `/api/workspaces/${id}/files`,
          form,
          {
            headers: form.getHeaders(),
            params: { path: target },
            timeout: 0,
            onUploadProgress: uploadProgress(
              (t) => (spinner.text = t),
              `上传 ${target}`,
              size
            ),
          }
        );
        const verb =
          data.status === 'created'
            ? '已新增'
            : data.status === 'updated'
              ? '已替换'
              : '内容未变化（跳过）';
        spinner.succeed(`${verb}: ${data.path} (${formatSize(data.size)})`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ rm (删除单文件) ------
  ws.command('rm')
    .description('删除工作空间内的单个文件')
    .argument('<id>', '工作空间 ID')
    .argument('<path>', '工作空间内文件路径（可用 tree --filter 查询）')
    .option('-y, --yes', '跳过确认')
    .action(async (id: string, filePath: string, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(
            `确认删除工作空间 ${id} 内的 ${filePath}? (y/N) `
          );
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('删除中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/workspaces/${id}/files`, {
            params: { path: filePath },
          });
          spinner.succeed(`已删除: ${filePath}`);
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // ------ cat (读取文件内容) ------
  ws.command('cat')
    .description('输出工作空间内文件的原始内容（类似 cat）')
    .argument('<id>', '工作空间 ID')
    .argument('<path>', '工作空间内文件路径')
    .option('-o, --output <file>', '保存到本地文件而非打印')
    .action(async (id: string, filePath: string, options) => {
      const spinner = ora('读取中...').start();
      try {
        const client = getClient();
        const encoded = filePath
          .split('/')
          .map((seg) => encodeURIComponent(seg))
          .join('/');
        const res = await client.get(
          `/api/workspaces/${id}/serve/${encoded}`,
          { responseType: 'arraybuffer' }
        );
        spinner.stop();
        const buf = Buffer.from(res.data);
        if (options.output) {
          const abs = path.resolve(options.output);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, buf);
          printSuccess(`已保存到: ${abs} (${formatSize(buf.length)})`);
        } else {
          process.stdout.write(buf);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ download (整包) ------
  ws.command('download')
    .description('下载工作空间全部文件（zip 整包，保留目录结构）')
    .argument('<id>', '工作空间 ID')
    .option('-o, --output <dir>', '输出目录', '.')
    .action(async (id: string, options) => {
      const spinner = ora('下载中...').start();
      try {
        const client = getClient();
        const res = await client.get(`/api/workspaces/${id}/download`, {
          responseType: 'stream',
          timeout: 0,
        });
        const name = filenameFromDisposition(
          res.headers['content-disposition'],
          `workspace-${id}.zip`
        );
        const target = path.join(options.output, name);
        const abs = await saveStream(res.data, target);
        spinner.succeed(`已下载: ${abs}`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ share ------
  ws.command('share')
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
        let url = `${shareBase()}/${data.share_token}`;
        if (options.file) {
          // 文件级深链：分享页消费 ?file= 直达目标文件
          url += `?file=${encodeURIComponent(options.file)}`;
        }
        if (options.json) {
          console.log(
            JSON.stringify(
              { share_token: data.share_token, file: options.file || null, url },
              null,
              2
            )
          );
        } else {
          printSuccess('分享链接: ' + url);
          if (options.file) {
            console.log(`  ↳ 打开后直达文件: ${options.file}`);
          }
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ unshare ------
  ws.command('unshare')
    .description('撤销工作空间分享链接（原链接立即失效）')
    .argument('<id>', '工作空间 ID')
    .option('-y, --yes', '跳过确认')
    .action(async (id: string, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(
            `确认撤销工作空间 ${id} 的分享链接? 已发出的链接将失效 (y/N) `
          );
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('撤销中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/workspaces/${id}/share`);
          spinner.succeed('分享已撤销');
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

