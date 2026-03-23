import { defineConfig } from 'vite'
import path from 'node:path'
import { cpSync, existsSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

function copyPlaywrightWrapper() {
  return {
    name: 'copy-playwright-wrapper',
    closeBundle() {
      const src = path.join(__dirname, 'electron', 'playwright-maximize-wrapper')
      const dest = path.join(__dirname, 'dist-electron', 'playwright-maximize-wrapper')
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true })
      }
    },
  }
}

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
    copyPlaywrightWrapper(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        onstart(args) {
          // 每次主进程 / preload 的 watch 构建完成都重启 Electron。
          // 若仅在首次 startup，主进程新增 ipcMain.handle 后旧进程不会加载新代码，会出现
          // "No handler registered for '…'"（例如 project:quality-check）。
          args.startup()
        },
        vite: {
          build: {
            rollupOptions: {
              external: [
                'sqlite3',
                'sequelize',
                'better-sqlite3',
                '@modelcontextprotocol/sdk',
                'node-pty',
                '@mtfe/sso-web-oidc-cli',
                '@mtfe/sso-web-oidc-base',
                'proper-lockfile',
                'node-fetch',
                'open',
                'whatwg-url',
                'tr46',
                'webidl-conversions',
              ],
            },
          },
          // 监听整个 electron/ 目录，确保子模块（如 config/SsoStore.ts）变化也触发重编译
          server: {
            watch: {
              usePolling: true,
              interval: 500,
            },
          },
        },
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
