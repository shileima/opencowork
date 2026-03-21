import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import checker from 'vite-plugin-checker'

export default defineConfig({
  plugins: [
    react(),
    checker({
      typescript: { tsconfigPath: 'tsconfig.app.json' },
      overlay: { initialIsOpen: 'error' }
    })
  ],
  server: {
    port: 3000,
    host: '127.0.0.1', // 显式绑定 IPv4，确保 127.0.0.1 与 localhost 均可访问
    open: true
  }
})
