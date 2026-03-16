import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
    server: {
    // 指定端口，默认 5173
    port: 5173,
    // 指定 IP，0.0.0.0 允许外部访问
    host: '0.0.0.0', 
    // 端口被占用时自动递增
    strictPort: false 
  }
})
