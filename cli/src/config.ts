import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface KBConfig {
  server?: string;
  token?: string;
  username?: string;
}

const CONFIG_PATH = path.join(os.homedir(), '.kbconfig.json');

export function loadConfig(): KBConfig {
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
