import axios, { AxiosInstance } from 'axios';
import { loadConfig } from './config';

let clientInstance: AxiosInstance | null = null;

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
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          throw new Error('登录已过期，请重新执行: kb login');
        }
        if (axios.isAxiosError(err) && err.code === 'ECONNREFUSED') {
          throw new Error(`无法连接到服务端，请检查地址: ${config.server}`);
        }
        if (axios.isAxiosError(err) && err.code === 'ETIMEDOUT') {
          throw new Error('请求超时，请检查网络连接');
        }
        if (axios.isAxiosError(err) && err.response?.data?.detail) {
          throw new Error(err.response.data.detail);
        }
        throw err;
      }
    );
  }

  return clientInstance;
}

export function resetClient(): void {
  clientInstance = null;
}
