import { Command } from 'commander';
import { getClient } from '../client';
import { printTable, printError, printWarning } from '../utils/table';
import { formatSize, formatTime, truncate } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import type { DocumentItem, DocumentVersion, SearchResult } from '../types';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

const ALLOWED_EXTS = ['.md', '.html', '.htm'];

function resolveFiles(patterns: string[]): string[] {
  const files: string[] = [];
  for (const p of patterns) {
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        files.push(p);
      } else if (stat.isDirectory()) {
        walkDir(p, files);
      }
    } else {
      const dir = path.dirname(p) || '.';
      const basename = path.basename(p);
      if (basename.includes('*')) {
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            const full = path.join(dir, entry);
            if (fs.statSync(full).isFile() && matchGlob(entry, basename)) {
              files.push(full);
            }
          }
        } catch {
          printWarning(`未找到匹配: ${p}`);
        }
      } else {
        printWarning(`文件不存在: ${p}`);
      }
    }
  }
  return [...new Set(files)];
}

function walkDir(dir: string, result: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXTS.includes(ext)) {
        result.push(full);
      }
    }
  }
}

function matchGlob(name: string, pattern: string): boolean {
  const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
  return re.test(name);
}

export function registerDocumentCommands(program: Command): void {
  // ------ push ------
  program
    .command('push')
    .description('上传 .md / .html 文件到指定集合')
    .argument('<files...>', '文件路径，支持通配符（如 docs/*.md）')
    .requiredOption('-c, --collection <id>', '目标集合 ID')
    .option('-o, --overwrite', '替换同名文件（保留文档 ID 和元数据，旧版本可追溯）')
    .action(async (files: string[], options) => {
      const resolved = resolveFiles(files);
      if (resolved.length === 0) {
        printError('没有找到可上传的文件（仅支持 .md/.html/.htm）');
        process.exit(1);
      }

      const spinner = ora(`准备上传 ${resolved.length} 个文件...`).start();
      try {
        const client = getClient();
        const form = new FormData();

        for (const f of resolved) {
          const ext = path.extname(f).toLowerCase();
          if (!ALLOWED_EXTS.includes(ext)) {
            printWarning(`跳过不支持的文件类型: ${f}`);
            continue;
          }
          form.append('files', fs.createReadStream(f), path.basename(f));
        }

        // 检查是否有有效文件被添加到表单
        const formLength = (form as any)._streams?.filter(
          (s: any) => s && typeof s !== 'function'
        ).length || 0;
        if (formLength === 0) {
          spinner.fail('所有文件均被跳过（仅支持 .md/.html/.htm）');
          process.exit(1);
        }

        const colId = options.collection;
        const params: Record<string, any> = {};
        if (options.overwrite) params.mode = 'overwrite';

        const { data } = await client.post<{ created: DocumentItem[]; updated: DocumentItem[]; duplicated: string[] }>(
          `/api/collections/${colId}/documents`,
          form,
          { headers: form.getHeaders(), params }
        );

        const { created, updated, duplicated } = data;
        spinner.succeed(`上传完成: ${created?.length || 0} 个文档, ${updated?.length || 0} 个文件已覆盖`);
        if (duplicated?.length > 0) {
          printWarning(`以下文件因内容重复已跳过: ${duplicated.join(', ')}`);
        }
        if (created?.length > 0) {
          const rows = created.map((d) => [
            String(d.id),
            truncate(d.title, 30),
            d.filename,
            formatSize(d.size),
          ]);
          printTable(['ID', '标题', '文件名', '大小'], rows);
        }
        if (updated?.length > 0) {
          const upRows = updated.map((d: any) => [
            String(d.id), truncate(d.title, 30), d.filename, formatSize(d.size), `v${d.current_version || ''}`
          ]);
          printTable(['ID', '标题', '文件名', '大小', '版本'], upRows);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ list ------
  program
    .command('list')
    .description('列出指定集合下的全部文档')
    .requiredOption('-c, --collection <id>', '集合 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<DocumentItem[]>(
          `/api/collections/${options.collection}/documents`
        );
        spinner.stop();
        const rows = data.map((d) => [
          String(d.id),
          truncate(d.title, 30),
          d.filename,
          d.ext,
          formatSize(d.size),
          d.tags || '-',
          formatTime(d.updated_at || d.created_at),
        ]);
        printTable(
          ['ID', '标题', '文件名', '类型', '大小', '标签', '更新时间'],
          rows,
          { json: options.json }
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ search ------
  program
    .command('search')
    .description('全文检索已上传的文档内容')
    .argument('<query>', '搜索关键词')
    .option('--json', 'JSON 格式输出')
    .action(async (query: string, options) => {
      const spinner = ora(`搜索 "${query}"...`).start();
      try {
        const client = getClient();
        const { data } = await client.get<SearchResult[]>('/api/search', {
          params: { q: query },
        });
        spinner.stop();
        if (data.length === 0) {
          console.log(`未找到匹配 "${query}" 的文档`);
          return;
        }
        const rows = data.map((r) => [
          String(r.document_id),
          truncate(r.title, 30),
          r.collection_name,
          r.ext,
          truncate(r.snippet, 60),
        ]);
        printTable(['ID', '标题', '所属集合', '类型', '摘要'], rows, { json: options.json });
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ get ------
  program
    .command('get')
    .description('查看文档详情')
    .argument('<id>', '文档 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (id: string, options) => {
      const spinner = ora('加载中...').start();
      try {
        const client = getClient();
        const { data } = await client.get<DocumentItem>(`/api/documents/${id}`);
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        printTable(
          ['属性', '值'],
          [
            ['ID', String(data.id)],
            ['标题', data.title],
            ['文件名', data.filename],
            ['类型', data.ext],
            ['大小', formatSize(data.size)],
            ['标签', data.tags || '-'],
            ['备注', data.note || '-'],
            ['SHA1', data.content_sha1],
            ['创建时间', formatTime(data.created_at)],
            ['更新时间', formatTime(data.updated_at)],
          ]
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ download ------
  program
    .command('download')
    .description('下载文档到本地')
    .argument('<id>', '文档 ID')
    .option('-o, --output <dir>', '输出目录', '.')
    .action(async (id: string, options) => {
      const spinner = ora('下载中...').start();
      try {
        const client = getClient();
        const { data: doc } = await client.get<DocumentItem>(`/api/documents/${id}`);
        const res = await client.get(`/api/documents/${id}/download`, {
          responseType: 'stream',
        });
        const outputPath = path.join(options.output, doc.filename);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const writer = fs.createWriteStream(outputPath);
        res.data.pipe(writer);
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          res.data.on('error', reject);
        });
        spinner.succeed(`已下载: ${outputPath}`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ update ------
  program
    .command('update')
    .description('更新文档信息（标题/标签/备注）')
    .argument('<id>', '文档 ID')
    .option('--title <title>', '新标题')
    .option('--tags <tags>', '新标签（逗号分隔）')
    .option('--note <note>', '新备注')
    .action(async (id: string, options) => {
      if (!options.title && !options.tags && !options.note) {
        printError('请至少指定一个更新项: --title / --tags / --note');
        process.exit(1);
      }
      const spinner = ora('更新中...').start();
      try {
        const client = getClient();
        const body: Record<string, any> = {};
        if (options.title) body.title = options.title;
        if (options.tags) body.tags = options.tags;
        if (options.note) body.note = options.note;
        const { data } = await client.patch<DocumentItem>(`/api/documents/${id}`, body);
        spinner.succeed('文档已更新');
        printTable(
          ['属性', '值'],
          [
            ['ID', String(data.id)],
            ['标题', data.title],
            ['标签', data.tags || '-'],
            ['备注', data.note || '-'],
          ]
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ delete ------
  program
    .command('delete')
    .description('删除文档')
    .argument('<id>', '文档 ID')
    .option('-y, --yes', '跳过确认')
    .action(async (id: string, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(`确认删除文档 ID=${id}? (y/N) `);
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('删除中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/documents/${id}`);
          spinner.succeed('文档已删除');
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // ------ version:list ------
  program
    .command('version:list')
    .description('查看文档版本历史')
    .argument('<docId>', '文档 ID')
    .option('--json', 'JSON 格式输出')
    .action(async (docId, options) => {
      const spinner = ora('加载版本列表...').start();
      try {
        const client = getClient();
        const { data } = await client.get<DocumentVersion[]>(`/api/documents/${docId}/versions`);
        spinner.stop();
        if (!data.length) {
          console.log('暂无历史版本');
          return;
        }
        const rows = data.map((v) => [
          String(v.version),
          formatSize(v.size),
          formatTime(v.created_at),
        ]);
        printTable(['版本', '大小', '创建时间'], rows, { json: options.json });
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ version:view ------
  program
    .command('version:view')
    .description('查看指定版本的内容')
    .argument('<docId>', '文档 ID')
    .argument('<version>', '版本号')
    .option('-o, --output <path>', '保存到文件')
    .action(async (docId, version, options) => {
      const spinner = ora('加载版本内容...').start();
      try {
        const client = getClient();
        const { data } = await client.get<{ version: any; content: string }>(
          `/api/documents/${docId}/versions/${version}`
        );
        spinner.stop();
        if (options.output) {
          fs.writeFileSync(options.output, data.content);
          console.log(`已保存到: ${options.output}`);
        } else {
          console.log(data.content);
        }
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ version:restore ------
  program
    .command('version:restore')
    .description('恢复文档到指定版本')
    .argument('<docId>', '文档 ID')
    .argument('<version>', '版本号')
    .option('-y, --yes', '跳过确认')
    .action(async (docId, version, options) => {
      if (!options.yes) {
        const ok = await askConfirm(`确认恢复文档 ${docId} 到版本 ${version}？当前内容将保存为新版本`);
        if (!ok) {
          console.log('已取消');
          return;
        }
      }
      const spinner = ora('恢复中...').start();
      try {
        const client = getClient();
        await client.post(`/api/documents/${docId}/versions/${version}/restore`);
        spinner.succeed(`已恢复到版本 ${version}`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });
}
