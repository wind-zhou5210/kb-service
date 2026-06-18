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
  .description('kb-service 知识库命令行工具')
  .version('0.1.0')
  .addHelpText(
    'after',
    '\n使用 kb <command> --help 查看子命令详情\n示例:\n  kb config set server https://kb.example.com\n  kb login -u admin\n  kb push ./doc.md -c 1\n  kb search "部署流程"'
  );

registerConfigCommands(program);
registerAuthCommands(program);
registerCollectionCommands(program);
registerDocumentCommands(program);
registerShareCommands(program);

program.parse();
