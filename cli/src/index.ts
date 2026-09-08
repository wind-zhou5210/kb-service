#!/usr/bin/env node

import { Command } from 'commander';
import { registerConfigCommands } from './commands/config';
import { registerAuthCommands } from './commands/auth';
import { registerCollectionCommands } from './commands/collection';
import { registerDocumentCommands } from './commands/document';
import { registerShareCommands } from './commands/share';
import { registerWorkspaceCommands } from './commands/workspace';

const program = new Command();

program
  .name('kb')
  .description('kb-service 知识库命令行工具 — 终端即可完成知识/工作空间的上传、管理与检索')
  .version('0.2.0')
  .addHelpText(
    'before',
    `
┌─────────────── 快速开始 ───────────────┐
│                                         │
│  $ kb config set server <url>           │
│  $ kb login admin                       │
│  $ kb push ./doc.md -c <集合ID>         │
│  $ kb push ./prd.zip -c <集合ID>        │
│  $ kb search "关键词"                   │
│                                         │
└─────────────────────────────────────────┘
`
  )
  .addHelpText(
    'after',
    `
─────────── 分组说明 ───────────
  认证:      login   logout   whoami
  配置:      config
  集合:      collection | col    (list/get/create/update/delete)
  文档:      push   list   search   get   raw   download   update   move   delete
  版本:      version:list   version:view   version:restore   version:delete
  工作空间:  workspace | ws      (list/get/create/update/delete/tree/
                                  upload/push/rm/cat/download/share/unshare)
  分享:      share   share list   share revoke

─────────── 上传限制 ───────────
  单文档 .md/.html ≤ 10MB   zip 文档包 ≤ 100MB   工作空间文件 ≤ 500MB

─────────── 常用示例 ───────────
  # 首次配置
  $ kb config set server https://kb.example.com
  $ kb login admin

  # 知识集合与文档
  $ kb col list                       # 查看集合
  $ kb push ./docs/*.md -c 1          # 批量上传 md
  $ kb push ./prd.md -c 1 -o          # 覆盖同名文档（生成新版本）
  $ kb push ./prd.zip -c 1            # 上传文档包（md + 图片资产）
  $ kb list -c 1                      # 查看集合下文档
  $ kb search "部署流程"               # 全文检索
  $ kb raw 5                          # 终端直接输出文档正文
  $ kb get 5                          # 查看文档详情
  $ kb update 5 --title "新标题" --tags "标签"
  $ kb move 5 -c 2                    # 移动文档到其他集合
  $ kb download --all -c 1 -o ./out   # 批量下载集合内全部文档

  # 版本历史
  $ kb version:list 5                 # 查看版本
  $ kb version:view 5 2               # 查看 v2 内容
  $ kb version:restore 5 2            # 恢复到 v2
  $ kb version:delete 5 1 -y          # 删除 v1

  # 工作空间（多文件/原型）
  $ kb ws list                        # 列出工作空间
  $ kb ws create "产品原型"            # 新建
  $ kb ws upload 1 ./dist.zip         # zip 全量替换
  $ kb ws push 1 ./todo.html -p pages/todo.html
  $ kb ws tree 1 --filter todo        # 目录树/按关键词查文件
  $ kb ws cat 1 todo.html             # 查看文件内容
  $ kb ws download 1 -o ./out         # 整包下载

  # 分享
  $ kb share collection 1             # 集合分享链接
  $ kb share document 5               # 文档分享链接
  $ kb share workspace 1 -f todo.html # 直达指定文件的工作空间链接
  $ kb share list                     # 查看所有已分享对象
  $ kb share revoke document 5        # 撤销分享

  # 清理
  $ kb delete 5 -y                    # 跳过确认删除文档
  $ kb collection delete 2 -y         # 跳过确认删除集合
  $ kb ws delete 1 -y                 # 跳过确认删除工作空间

使用 kb <command> --help 查看子命令详情
`
  );

registerConfigCommands(program);
registerAuthCommands(program);
registerCollectionCommands(program);
registerDocumentCommands(program);
registerWorkspaceCommands(program);
registerShareCommands(program);

program.parse();
