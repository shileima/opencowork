import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '127.0.0.1', // 显式绑定 IPv4，确保 127.0.0.1 与 localhost 均可访问
    open: true
  }
})
