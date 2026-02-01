import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // 确保 Electron 渲染进程能正确连接 HMR WebSocket
    hmr: {
      host: 'localhost',
      protocol: 'ws',
      clientPort: undefined, // 与 dev server 同端口
    },
    // 部分环境（如部分 macOS/网络盘）下 inotify 不触发，用轮询保证修改能被检测
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: [
                'sqlite3',
                'sequelize',
                'better-sqlite3',
                '@modelcontextprotocol/sdk'
              ],
            },
          }
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              external: [
                'sqlite3',
                'sequelize',
                'better-sqlite3',
                '@modelcontextprotocol/sdk'
              ],
            },
          }
        }
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
