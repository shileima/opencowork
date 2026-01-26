import { useState, useEffect } from 'react'
import { AlertCircle, Download, CheckCircle, Loader } from 'lucide-react'

interface PlaywrightStatus {
  installed: boolean
  playwrightInstalled: boolean
  browserInstalled: boolean
  needsInstall: boolean
}

interface PlaywrightPromptProps {
  onDismiss?: () => void
}

export function PlaywrightPrompt({ onDismiss }: PlaywrightPromptProps) {
  const [status, setStatus] = useState<PlaywrightStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // 检查状态
    checkStatus()

    // 监听状态更新
    const removeStatusListener = window.ipcRenderer.on('playwright:status', (_event, ...args) => {
      const newStatus = args[0] as PlaywrightStatus
      setStatus(newStatus)
      if (newStatus.installed) {
        setInstalling(false)
      }
    })

    // 监听安装进度
    const removeProgressListener = window.ipcRenderer.on('playwright:install-progress', (_event, ...args) => {
      const message = args[0] as string
      setProgress(message)
    })

    return () => {
      removeStatusListener()
      removeProgressListener()
    }
  }, [])

  const checkStatus = async () => {
    try {
      const result = await window.ipcRenderer.invoke('playwright:get-status') as {
        success: boolean
        playwrightInstalled?: boolean
        browserInstalled?: boolean
        needsInstall?: boolean
        error?: string
      }
      
      if (result.success) {
        setStatus({
          installed: !result.needsInstall,
          playwrightInstalled: result.playwrightInstalled || false,
          browserInstalled: result.browserInstalled || false,
          needsInstall: result.needsInstall || false
        })
      }
    } catch (err) {
      console.error('检查 Playwright 状态失败:', err)
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setError('')
    setProgress('准备安装...')

    try {
      const result = await window.ipcRenderer.invoke('playwright:install') as {
        success: boolean
        error?: string
      }
      
      if (!result.success) {
        setError(result.error || '安装失败')
        setInstalling(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败')
      setInstalling(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  // 如果已安装或已关闭,不显示
  if (!status || !status.needsInstall || dismissed) {
    return null
  }

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-1">
            需要安装 Playwright 浏览器
          </h3>
          
          <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
            自动化功能需要 Playwright 和 Chromium 浏览器。点击下方按钮一键安装(约 150MB)。
          </p>

          {error && (
            <div className="mb-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {installing && progress && (
            <div className="mb-3 text-sm text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
              <Loader className="w-4 h-4 animate-spin" />
              {progress}
            </div>
          )}

          {status.installed && (
            <div className="mb-3 text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              安装完成!
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleInstall}
              disabled={installing || status.installed}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-400 
                       text-white text-sm font-medium rounded-lg transition-colors
                       flex items-center gap-2 disabled:cursor-not-allowed"
            >
              {installing ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  安装中...
                </>
              ) : status.installed ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  已安装
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  立即安装
                </>
              )}
            </button>

            {!installing && !status.installed && (
              <button
                onClick={handleDismiss}
                className="px-4 py-2 text-sm text-yellow-700 dark:text-yellow-300 
                         hover:text-yellow-900 dark:hover:text-yellow-100 transition-colors"
              >
                稍后安装
              </button>
            )}
          </div>

          {!status.playwrightInstalled && !status.browserInstalled && (
            <p className="mt-3 text-xs text-yellow-600 dark:text-yellow-400">
              💡 提示: 安装过程需要几分钟,请保持网络连接
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
