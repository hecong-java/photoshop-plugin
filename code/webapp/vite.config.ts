import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 部署基路径：线上挂在 lemongrid.cn 的 /ps/ 子路径（https://lemongrid.cn/ps/）
  base: '/ps/',
    server: {
    // 指定端口，默认 5173
    port: 5173,
    // 指定 IP，0.0.0.0 允许外部访问
    host: '0.0.0.0',
    // 端口被占用时自动递增
    strictPort: false,
    // 261113：本地 dev 登录直连生产 API——后端 CORS 白名单只有 lemongrid.cn 和
    // localhost:3001（平台前端端口），5173 不在名单里，浏览器模式直接 fetch 会
    // Failed to fetch。走 vite 代理绕开 CORS：页面请求发给自己（同源），vite 在
    // Node 侧转发到生产，服务器间无 CORS 概念。仅 dev server 生效，构建产物不含。
    proxy: {
      '/api': {
        target: 'https://lemongrid.cn',
        changeOrigin: true,
        secure: true,
      },
      '/auth': {
        target: 'https://lemongrid.cn',
        changeOrigin: true,
        secure: true,
      },
    },
  }
})
