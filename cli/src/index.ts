#!/usr/bin/env node

import { Command } from 'commander';
import { registerConfigCommands } from './commands/config';
import { registerAuthCommands } from './commands/auth';
import { registerCollectionCommands } from './commands/collection';
import { registerDocumentCommands } from './commands/document';
import { registerShareCommands } from './commands/share';

const program = new Command();

program
  .name('kb')
  .description('kb-service 知识库命令行工具 — 终端即可完成知识的上传、管理与检索')
  .version('0.1.0')
  .addHelpText(
    'before',
    `
┌─────────────── 快速开始 ───────────────┐
│                                         │
│  $ kb config set server <url>           │
│  $ kb login admin                       │
│  $ kb push ./doc.md -c <集合ID>         │
│  $ kb search "关键词"                   │
│                                         │
└─────────────────────────────────────────┘
`
  )
  .addHelpText(
    'after',
    `
─────────── 分组说明 ───────────
  认证:  login   logout   whoami
  配置:  config
  集合:  collection | col
  文档:  push   list   search   get   download   update   delete
  分享:  share

─────────── 常用示例 ───────────
  # 首次配置
  $ kb config set server https://kb.example.com
  $ kb login admin

  # 日常上传
  $ kb push ./docs/*.md -c 1

  # 批量管理
  $ kb list -c 1              # 查看集合下文档
  $ kb search "部署流程"       # 全文检索
  $ kb get 1                  # 查看文档详情
  $ kb update 1 --title "新标题" --tags "标签"

  # 分享
  $ kb share collection 1     # 生成集合分享链接
  $ kb share document 5       # 生成文档分享链接

  # 清理
  $ kb delete 1 -y            # 跳过确认删除文档
  $ kb collection delete 2 -y # 跳过确认删除集合

使用 kb <command> --help 查看子命令详情
`
  );

registerConfigCommands(program);
registerAuthCommands(program);
registerCollectionCommands(program);
registerDocumentCommands(program);
registerShareCommands(program);

program.parse();
