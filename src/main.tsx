import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './i18n/I18nContext'
import { ThemeProvider } from './theme/ThemeContext'
import { ToastProvider } from './components/Toast'
import './index.css'

const rootEl = document.getElementById('root')!
const root = ReactDOM.createRoot(rootEl)

const AppTree = (
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider defaultTheme="system" storageKey="opencowork-ui-theme">
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>
)

root.render(AppTree)

// Electron 下有时 React Fast Refresh 不会触发父级重渲染，导致深层组件（如 FileExplorer）修改不生效。
// 当任意依赖更新时，强制从根重渲染一次，以使用最新模块。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    root.render(AppTree)
  })
}

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
