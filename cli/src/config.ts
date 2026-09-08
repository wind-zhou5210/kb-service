import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface KBConfig {
  server?: string;
  token?: string;
  username?: string;
}

const CONFIG_PATH = path.join(os.homedir(), '.kbconfig.json');

/**
 * 读取配置：环境变量优先于 ~/.kbconfig.json。
 * KB_SERVER / KB_TOKEN / KB_USERNAME 供 CI/CD 与脚本场景注入凭据，无需落盘。
 */
export function loadConfig(): KBConfig {
  let fileConfig: KBConfig = {};
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch {
    fileConfig = {};
  }
  return {
    server: (process.env.KB_SERVER || fileConfig.server || '').replace(/\/$/, '') || undefined,
    token: process.env.KB_TOKEN || fileConfig.token,
    username: process.env.KB_USERNAME || fileConfig.username,
  };
}

/** 仅读取文件配置（不含环境变量），用于展示配置来源 */
export function loadFileConfig(): KBConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveConfig(config: KBConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
