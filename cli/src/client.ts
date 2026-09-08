import axios, { AxiosInstance } from 'axios';
import { loadConfig } from './config';
import { describeUploadError } from './utils/limits';

let clientInstance: AxiosInstance | null = null;

/**
 * 从错误响应体提取后端 detail。
 * responseType 为 arraybuffer/stream 时 axios 不会解析错误体（为 Buffer），
 * 需手动解码；nginx 等中间层返回的 HTML 错误页解析失败则返回 null。
 */
function extractDetail(data: any): string | null {
  if (!data) return null;
  try {
    if (typeof data === 'string') {
      const parsed = JSON.parse(data);
      return typeof parsed?.detail === 'string' ? parsed.detail : null;
    }
    if (Buffer.isBuffer(data)) {
      const parsed = JSON.parse(data.toString('utf-8'));
      return typeof parsed?.detail === 'string' ? parsed.detail : null;
    }
    if (data instanceof ArrayBuffer) {
      const parsed = JSON.parse(Buffer.from(new Uint8Array(data)).toString('utf-8'));
      return typeof parsed?.detail === 'string' ? parsed.detail : null;
    }
    if (typeof data.detail === 'string') return data.detail;
  } catch {
    return null; // 非 JSON 错误体（如中间层 HTML）
  }
  return null;
}

export function getClient(): AxiosInstance {
  const config = loadConfig();
  if (!config.server) {
    throw new Error('未配置服务端地址，请先执行: kb config set server <url>');
  }

  if (!clientInstance || clientInstance.defaults.baseURL !== config.server) {
    clientInstance = axios.create({
      baseURL: config.server,
      timeout: 30_000,
      headers: { 'Content-Type': 'application/json' },
    });

    clientInstance.interceptors.request.use((reqConfig) => {
      const cfg = loadConfig();
      if (cfg.token) {
        reqConfig.headers.Authorization = `Bearer ${cfg.token}`;
      }
      return reqConfig;
    });

    clientInstance.interceptors.response.use(
      (res) => res,
      (err) => {
        // 统一转换为 Error 实例，避免 [object Object] 报错
        if (!axios.isAxiosError(err)) {
          throw new Error(err instanceof Error ? err.message : String(err));
        }
        if (err.code === 'ECONNREFUSED') {
          throw new Error(`无法连接到服务端，请检查地址: ${config.server}`);
        }
        if (err.code === 'ETIMEDOUT') {
          throw new Error('请求超时，请检查网络连接');
        }
        const status = err.response?.status;
        const detail = extractDetail(err.response?.data);
        // 401：登录接口失败时后端 detail 为「用户名或密码错误」，应优先展示；
        // 其余端点的 401 detail 为 FastAPI 默认英文（Not authenticated），改用中文引导
        if (status === 401) {
          const isLoginRequest = (err.config?.url || '').includes('/auth/login');
          if (isLoginRequest && detail) throw new Error(detail);
          throw new Error('未登录或登录已过期，请执行: kb login');
        }
        if (detail) {
          throw new Error(detail);
        }
        // 413：nginx 等中间层返回 HTML 错误页时无 detail，按端点补上限制说明
        if (status === 413) {
          throw new Error(describeUploadError(err, err.config?.url || ''));
        }
        if (status === 404) {
          throw new Error('资源不存在（404）：请检查 ID / 路径是否正确');
        }
        if (status === 403) {
          throw new Error('无权限访问该资源（403）');
        }
        if (status === 409) {
          throw new Error('资源冲突（409）：内容与已有数据重复');
        }
        if (status && status >= 500) {
          throw new Error(`服务端错误（${status}），请查看服务端日志`);
        }
        throw new Error(err.message || '请求失败');
      }
    );
  }

  return clientInstance;
}

export function resetClient(): void {
  clientInstance = null;
}
