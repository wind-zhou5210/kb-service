import { Command } from 'commander';
import { getClient } from '../client';
import { printTable, printError, printWarning, printSuccess } from '../utils/table';
import { formatSize, formatTime, truncate, highlightSnippet, plainSnippet } from '../utils/format';
import { askConfirm } from '../utils/prompt';
import { uploadProgress, saveStream, filenameFromDisposition } from '../utils/upload';
import {
  checkSizeLimit,
  PACKAGE_ZIP_MAX_MB,
  DOCUMENT_MAX_MB,
} from '../utils/limits';
import { loadConfig } from '../config';
import type {
  DocumentItem,
  DocumentVersion,
  SearchResult,
  UploadResult,
} from '../types';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';

const ALLOWED_EXTS = ['.md', '.html', '.htm'];
/** 文档包（zip：md/html 入口 + 图片资产），走 /documents/package 端点 */
const PACKAGE_EXT = '.zip';
const ACCEPT_EXTS = [...ALLOWED_EXTS, PACKAGE_EXT];
const isZip = (f: string) => f.toLowerCase().endsWith(PACKAGE_EXT);

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
      if (ACCEPT_EXTS.includes(ext)) {
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
    .description('上传文档到指定集合：.md/.html 单文件，.zip 走文档包（md/html + 图片资产）')
    .argument('<files...>', '文件路径，支持通配符与目录（如 docs/*.md、./prd.zip）')
    .requiredOption('-c, --collection <id>', '目标集合 ID')
    .option('-o, --overwrite', '替换同名文件（保留文档 ID 和元数据，旧版本可追溯）')
    .addHelpText(
      'after',
      `
限制: 单文件 ≤ ${DOCUMENT_MAX_MB}MB（.md/.html/.htm）；zip 文档包 ≤ ${PACKAGE_ZIP_MAX_MB}MB
文档包: zip 内每个 md/html 各建一个文档，包内图片作为资产挂载，md 内相对图片引用自动解析

示例:
  $ kb push ./docs/*.md -c 1              批量上传 md
  $ kb push ./prd.md -c 1 -o              覆盖同名文档（生成新版本）
  $ kb push ./prd.zip -c 1                上传文档包（md + images/ 目录）`
    )
    .action(async (files: string[], options) => {
      const resolved = resolveFiles(files);
      if (resolved.length === 0) {
        printError('没有找到可上传的文件（支持 .md/.html/.htm 与 .zip 文档包）');
        process.exit(1);
      }

      // 扩展名过滤：直接指定路径的文件不经 walkDir 过滤，需在此校验
      const accepted = resolved.filter((f) => {
        const ext = path.extname(f).toLowerCase();
        if (ACCEPT_EXTS.includes(ext)) return true;
        printWarning(`跳过不支持的文件类型: ${f}`);
        return false;
      });
      if (!accepted.length) {
        printError('所有文件均被跳过（支持 .md/.html/.htm 与 .zip 文档包）');
        process.exit(1);
      }

      // 上传前体积校验：避免大文件白白传输后才被拒，并给出限制说明
      const oversized: string[] = [];
      for (const f of accepted) {
        const limit = isZip(f) ? PACKAGE_ZIP_MAX_MB : DOCUMENT_MAX_MB;
        const msg = checkSizeLimit(fs.statSync(f).size, limit, path.basename(f));
        if (msg) oversized.push(msg);
      }
      if (oversized.length) {
        oversized.forEach((m) => printError(m));
        process.exit(1);
      }

      const zips = accepted.filter(isZip);
      const docs = accepted.filter((f) => !isZip(f));
      const colId = options.collection;
      const params: Record<string, any> = {};
      if (options.overwrite) params.mode = 'overwrite';

      const allCreated: DocumentItem[] = [];
      const allUpdated: DocumentItem[] = [];
      const allDup: string[] = [];

      // 1) zip 文档包：逐个走 package 端点（md/html 入口 + 图片资产）
      for (const zip of zips) {
        const size = fs.statSync(zip).size;
        const label = `上传文档包 ${path.basename(zip)}`;
        const spinner = ora(`${label} ...`).start();
        try {
          const client = getClient();
          const form = new FormData();
          form.append('file', fs.createReadStream(zip), path.basename(zip));
          const { data } = await client.post<UploadResult>(
            `/api/collections/${colId}/documents/package`,
            form,
            {
              headers: form.getHeaders(),
              params,
              timeout: 0, // 大包不设超时（实例默认 30s 对 100MB 不够）
              onUploadProgress: uploadProgress((t) => (spinner.text = t), label, size),
            }
          );
          spinner.succeed(
            `${path.basename(zip)}: 新建 ${data.created?.length || 0} 个文档，覆盖 ${data.updated?.length || 0} 个`
          );
          allCreated.push(...(data.created || []));
          allUpdated.push(...(data.updated || []));
          allDup.push(...(data.duplicated || []));
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      }

      // 2) 普通文档：批量一次请求
      if (docs.length) {
        const totalSize = docs.reduce((s, f) => s + fs.statSync(f).size, 0);
        const spinner = ora(`准备上传 ${docs.length} 个文件...`).start();
        try {
          const client = getClient();
          const form = new FormData();
          for (const f of docs) {
            form.append('files', fs.createReadStream(f), path.basename(f));
          }
          const { data } = await client.post<UploadResult>(
            `/api/collections/${colId}/documents`,
            form,
            {
              headers: form.getHeaders(),
              params,
              timeout: 0,
              onUploadProgress: uploadProgress(
                (t) => (spinner.text = t),
                '上传中',
                totalSize
              ),
            }
          );
          spinner.succeed(
            `上传完成: ${data.created?.length || 0} 个文档, ${data.updated?.length || 0} 个文件已覆盖`
          );
          allCreated.push(...(data.created || []));
          allUpdated.push(...(data.updated || []));
          allDup.push(...(data.duplicated || []));
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      }

      if (allDup.length > 0) {
        printWarning(`以下文件因内容重复已跳过: ${allDup.join(', ')}`);
      }
      if (allCreated.length > 0) {
        const rows = allCreated.map((d) => [
          String(d.id),
          truncate(d.title, 30),
          d.filename,
          formatSize(d.size),
        ]);
        printTable(['ID', '标题', '文件名', '大小'], rows);
      }
      if (allUpdated.length > 0) {
        const upRows = allUpdated.map((d) => [
          String(d.id),
          truncate(d.title, 30),
          d.filename,
          formatSize(d.size),
          `v${d.current_version || ''}`,
        ]);
        printTable(['ID', '标题', '文件名', '大小', '版本'], upRows);
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
        if (!data.length) {
          console.log(
            `集合 ${options.collection} 下暂无文档，可用 kb push <file> -c ${options.collection} 上传`
          );
          return;
        }
        const rows = data.map((d) => [
          String(d.id),
          truncate(d.title, 28),
          d.filename,
          d.ext,
          formatSize(d.size),
          d.tags || '-',
          d.share_token ? '已分享' : '-',
          formatTime(d.updated_at || d.created_at),
        ]);
        printTable(
          ['ID', '标题', '文件名', '类型', '大小', '标签', '分享', '更新时间'],
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
          // --json 用纯文本，避免 ANSI 色码污染机器可读输出
          options.json
            ? plainSnippet(r.snippet, 60)
            : highlightSnippet(r.snippet, 60),
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
            ['所属集合', String(data.collection_id)],
            ['当前版本', `v${data.current_version ?? 1}`],
            ['标签', data.tags || '-'],
            ['备注', data.note || '-'],
            ['包内目录', data.source_dir || '-'],
            [
              '分享',
              data.share_token
                ? `${loadConfig().server}/share/doc/${data.share_token}`
                : '(未分享)',
            ],
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
    .description('下载文档到本地；配合 --all -c <集合ID> 可批量下载整个集合')
    .argument('[id]', '文档 ID（与 --all 二选一）')
    .option('-o, --output <dir>', '输出目录', '.')
    .option('-a, --all', '下载指定集合下全部文档')
    .option('-c, --collection <id>', '集合 ID（配合 --all 使用）')
    .addHelpText(
      'after',
      `
示例:
  $ kb download 5                       下载单个文档到当前目录
  $ kb download 5 -o ./export           下载到指定目录
  $ kb download --all -c 1 -o ./export  批量下载集合 1 的全部文档`
    )
    .action(async (id: string | undefined, options) => {
      // 批量模式：先列出集合文档，再逐个下载
      if (options.all) {
        if (!options.collection) {
          printError('--all 需要配合 -c <集合ID> 使用');
          process.exit(1);
        }
        const spinner = ora('获取文档列表...').start();
        try {
          const client = getClient();
          const { data: docs } = await client.get<DocumentItem[]>(
            `/api/collections/${options.collection}/documents`
          );
          if (!docs.length) {
            spinner.info('该集合下暂无文档');
            return;
          }
          spinner.text = `下载 ${docs.length} 个文档...`;
          const saved: string[] = [];
          let failed = 0;
          for (const doc of docs) {
            try {
              const res = await client.get(`/api/documents/${doc.id}/download`, {
                responseType: 'stream',
                timeout: 0,
              });
              const name =
                doc.filename ||
                filenameFromDisposition(
                  res.headers['content-disposition'],
                  `doc-${doc.id}${doc.ext || ''}`
                );
              const abs = await saveStream(res.data, path.join(options.output, name));
              saved.push(abs);
            } catch (err: any) {
              failed++;
              printWarning(`下载失败 [${doc.id}] ${doc.filename}: ${err.message}`);
            }
          }
          spinner.stop();
          printSuccess(`已下载 ${saved.length} 个文档到 ${path.resolve(options.output)}`);
          if (failed) printWarning(`${failed} 个文档下载失败`);
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
        return;
      }

      if (!id) {
        printError('请指定文档 ID，或使用 --all -c <集合ID> 批量下载');
        process.exit(1);
      }
      const spinner = ora('下载中...').start();
      try {
        const client = getClient();
        const { data: doc } = await client.get<DocumentItem>(`/api/documents/${id}`);
        const res = await client.get(`/api/documents/${id}/download`, {
          responseType: 'stream',
          timeout: 0,
        });
        const abs = await saveStream(res.data, path.join(options.output, doc.filename));
        spinner.succeed(`已下载: ${abs}`);
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });

  // ------ update ------
  program
    .command('update')
    .description('更新文档信息（标题/标签/备注/排序）')
    .argument('<id>', '文档 ID')
    .option('--title <title>', '新标题')
    .option('--tags <tags>', '新标签（逗号分隔）')
    .option('--note <note>', '新备注')
    .option('--sort <order>', '排序值（整数，越小越靠前）')
    .action(async (id: string, options) => {
      if (!options.title && !options.tags && !options.note && options.sort === undefined) {
        printError('请至少指定一个更新项: --title / --tags / --note / --sort');
        process.exit(1);
      }
      const spinner = ora('更新中...').start();
      try {
        const client = getClient();
        const body: Record<string, any> = {};
        if (options.title) body.title = options.title;
        if (options.tags) body.tags = options.tags;
        if (options.note) body.note = options.note;
        if (options.sort !== undefined) {
          const n = Number(options.sort);
          if (!Number.isInteger(n)) {
            spinner.fail('--sort 需为整数');
            process.exit(1);
          }
          body.sort_order = n;
        }
        const { data } = await client.patch<DocumentItem>(`/api/documents/${id}`, body);
        spinner.succeed('文档已更新');
        printTable(
          ['属性', '值'],
          [
            ['ID', String(data.id)],
            ['标题', data.title],
            ['标签', data.tags || '-'],
            ['备注', data.note || '-'],
            ['排序', String(data.sort_order)],
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

  // ------ version:delete ------
  program
    .command('version:delete')
    .description('删除文档的指定历史版本（释放对应内容存储引用）')
    .argument('<docId>', '文档 ID')
    .argument('<version>', '版本号')
    .option('-y, --yes', '跳过确认')
    .action(async (docId, version, options) => {
      try {
        if (!options.yes) {
          const ok = await askConfirm(
            `确认删除文档 ${docId} 的版本 v${version}? 该版本内容将不可恢复 (y/N) `
          );
          if (!ok) {
            console.log('已取消');
            return;
          }
        }
        const spinner = ora('删除版本中...').start();
        try {
          const client = getClient();
          await client.delete(`/api/documents/${docId}/versions/${version}`);
          spinner.succeed(`已删除版本 v${version}`);
        } catch (err: any) {
          spinner.fail(err.message);
          process.exit(1);
        }
      } catch (err: any) {
        printError(err.message);
        process.exit(1);
      }
    });

  // ------ raw ------
  program
    .command('raw')
    .description('在终端直接输出文档正文（类似 cat）')
    .argument('<id>', '文档 ID')
    .option('-o, --output <file>', '保存到本地文件而非打印')
    .option('--html', 'HTML 文档返回包装后的 srcdoc 内容（含净化与高度上报脚本）')
    .addHelpText(
      'after',
      `
示例:
  $ kb raw 5                    输出文档正文到终端
  $ kb raw 5 | head -20         管道查看前 20 行
  $ kb raw 5 -o ./out.md        保存为本地文件

说明: 文档包（zip）内的 md，其相对图片引用会被重写为资产端点路径`
    )
    .action(async (id: string, options) => {
      const spinner = ora('读取中...').start();
      try {
        const client = getClient();
        const params: Record<string, any> = {};
        if (options.html) params.format = 'html';
        const res = await client.get(`/api/documents/${id}/raw`, {
          params,
          responseType: 'arraybuffer',
        });
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

  // ------ move ------
  program
    .command('move')
    .description('将文档移动到另一个集合')
    .argument('<id>', '文档 ID')
    .requiredOption('-c, --collection <id>', '目标集合 ID')
    .action(async (id: string, options) => {
      const spinner = ora('移动中...').start();
      try {
        const client = getClient();
        const { data } = await client.post<DocumentItem>(
          `/api/documents/${id}/move`,
          { collection_id: Number(options.collection) }
        );
        spinner.succeed(`文档已移动到集合 ${data.collection_id}`);
        printTable(
          ['属性', '值'],
          [
            ['ID', String(data.id)],
            ['标题', data.title],
            ['所属集合', String(data.collection_id)],
          ]
        );
      } catch (err: any) {
        spinner.fail(err.message);
        process.exit(1);
      }
    });
}
