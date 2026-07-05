import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * vite 配置。
 * - server.host = '0.0.0.0'：让同局域网的手机可以访问前端页面；
 * - server.proxy：将 /api 反向代理到后端 http://localhost:8001。
 *
 * 注意：在 Capacitor 打包生成的原生 App 中，前端请求不会经过 vite dev server，
 * 需通过环境变量 VITE_API_BASE_URL 显式指定后端地址。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
});
