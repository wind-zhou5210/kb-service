import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时把 /api 代理到后端 FastAPI（默认 8000）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    // 收窄文件监视范围：降低 inotify 用量（低配机器 8192 上限易满）
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/data/**'],
      // M-4：inotify 上限低的机器用 VITE_USE_POLLING=1 启用轮询（默认不强制全员）
      usePolling: process.env.VITE_USE_POLLING === '1',
    },
  },
  build: {
    outDir: 'dist',
  },
})
