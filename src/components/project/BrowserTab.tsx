import { useState, useCallback, useEffect, useRef } from 'react';
import { ExternalLink, RotateCw, Globe } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_URL = ''; // 默认为空，避免启动时立即尝试连接

/** 注入到预览页的 CSS：将 Vite 错误 overlay 字号小 1 号 */
const VITE_ERROR_OVERLAY_CSS = `
  [data-vite-error-overlay], .vite-error-overlay, [class*="vite-error-overlay"] {
    font-size: 87.5% !important;
  }
  [data-vite-error-overlay] *, .vite-error-overlay * {
    font-size: inherit !important;
  }
`;

interface BrowserTabProps {
    initialUrl?: string;
    /** 外部刷新触发器：数值变化时强制刷新 webview */
    refreshTrigger?: number;
}

const ensureProtocol = (url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) {
        return `http://${trimmed}`;
    }
    return trimmed;
};

export function BrowserTab({ initialUrl = DEFAULT_URL, refreshTrigger = 0 }: BrowserTabProps) {
    const { t } = useI18n();
    const [url, setUrl] = useState(initialUrl || '');
    const [currentUrl, setCurrentUrl] = useState(initialUrl || '');
    const [isLoading, setIsLoading] = useState(!!(initialUrl || '').trim());
    const [refreshKey, setRefreshKey] = useState(0); // 用于强制刷新 webview
    const [loadError, setLoadError] = useState<string | null>(null); // 加载错误信息
    const webviewRef = useRef<HTMLElement | null>(null);

    // 组件挂载时打印诊断信息
    useEffect(() => {
        console.log('[BrowserTab] 组件已挂载', {
            initialUrl,
            refreshTrigger,
            userAgent: navigator.userAgent,
            isElectron: !!(window as any).ipcRenderer,
            webviewTagSupported: typeof document.createElement('webview') !== 'undefined',
        });
    }, []);

    const handleNavigate = useCallback(() => {
        const fullUrl = ensureProtocol(url);
        if (fullUrl) {
            setCurrentUrl(fullUrl);
            setIsLoading(true);
        }
    }, [url]);

    const handleRefresh = useCallback(() => {
        if (webviewRef.current) {
            setIsLoading(true);
            setRefreshKey(prev => prev + 1);
        }
    }, []);

    // 当父组件更新 URL（如 Agent 调用 open_browser_preview）时同步
    useEffect(() => {
        const fullUrl = initialUrl ? ensureProtocol(initialUrl) : '';
        if (fullUrl) {
            setUrl(fullUrl);
            setCurrentUrl(fullUrl);
            setIsLoading(true);
        }
    }, [initialUrl]);

    // 外部刷新触发器（如对话完成后自动刷新）
    useEffect(() => {
        if (refreshTrigger > 0 && currentUrl) {
            setIsLoading(true);
            setRefreshKey(prev => prev + 1);
        }
    }, [refreshTrigger]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNavigate();
        }
    };

    // webview 加载完成后隐藏 loading 并注入 CSS（缩小 Vite 报错 overlay 字号）
    useEffect(() => {
        const el = webviewRef.current;
        if (!currentUrl || !el) {
            console.log('[BrowserTab] webview 未就绪', { currentUrl, hasEl: !!el });
            return;
        }

        console.log('[BrowserTab] 开始监听 webview 事件', { currentUrl, refreshKey });

        // 监听 webview 各生命周期事件以排查加载问题
        const onDidStartLoading = () => {
            console.log('[BrowserTab] webview did-start-loading', { url: currentUrl });
            setLoadError(null);
        };
        const onDidStopLoading = () => {
            console.log('[BrowserTab] webview did-stop-loading', { url: currentUrl });
        };
        const onDidFinishLoad = () => {
            console.log('[BrowserTab] webview did-finish-load (成功)', { url: currentUrl });
            setIsLoading(false);
            setLoadError(null);
            try {
                (el as unknown as { insertCSS: (css: string) => void }).insertCSS(VITE_ERROR_OVERLAY_CSS);
            } catch (e) {
                console.warn('[BrowserTab] 注入 CSS 失败:', e);
            }
        };
        const onDidFailLoad = (event: any) => {
            const errorCode = event?.errorCode ?? 'unknown';
            const errorDescription = event?.errorDescription ?? 'unknown';
            const validatedURL = event?.validatedURL ?? currentUrl;
            console.error('[BrowserTab] webview did-fail-load (加载失败)', {
                errorCode,
                errorDescription,
                validatedURL,
                currentUrl,
                isMainFrame: event?.isMainFrame,
            });
            setIsLoading(false);
            
            // 优化错误提示：针对常见错误提供友好的提示
            let friendlyError = '';
            if (errorCode === -102 || errorDescription === 'ERR_CONNECTION_REFUSED') {
                friendlyError = `无法连接到 ${validatedURL}。请确保开发服务器正在运行。`;
            } else if (errorCode === -3 || errorDescription === 'ERR_ABORTED') {
                // 页面加载被中断，通常是用户主动操作，不显示错误
                return;
            } else {
                friendlyError = `加载失败 (${errorCode}): ${errorDescription}`;
            }
            setLoadError(friendlyError);
        };
        const onCrashed = () => {
            console.error('[BrowserTab] webview crashed! (webview 进程崩溃)');
            setIsLoading(false);
            setLoadError('webview 进程崩溃');
        };
        const onDestroyed = () => {
            console.warn('[BrowserTab] webview destroyed');
        };
        const onConsoleMessage = (event: any) => {
            // 打印 webview 内部的 console 信息，帮助排查页面内部错误
            const level = event?.level ?? 0;
            const message = event?.message ?? '';
            const levelStr = ['LOG', 'WARN', 'ERROR', 'DEBUG'][level] || 'LOG';
            console.log(`[BrowserTab] webview console [${levelStr}]:`, message);
        };
        const onDomReady = () => {
            console.log('[BrowserTab] webview dom-ready', { url: currentUrl });
            // 打印 webview 内部页面信息
            try {
                const wv = el as any;
                if (typeof wv.getURL === 'function') {
                    console.log('[BrowserTab] webview 当前 URL:', wv.getURL());
                }
                if (typeof wv.getTitle === 'function') {
                    console.log('[BrowserTab] webview 页面标题:', wv.getTitle());
                }
            } catch (e) {
                console.warn('[BrowserTab] 获取 webview 信息失败:', e);
            }
        };

        el.addEventListener('did-start-loading', onDidStartLoading);
        el.addEventListener('did-stop-loading', onDidStopLoading);
        el.addEventListener('did-finish-load', onDidFinishLoad);
        el.addEventListener('did-fail-load', onDidFailLoad);
        el.addEventListener('crashed', onCrashed);
        el.addEventListener('destroyed', onDestroyed);
        el.addEventListener('console-message', onConsoleMessage);
        el.addEventListener('dom-ready', onDomReady);

        return () => {
            el.removeEventListener('did-start-loading', onDidStartLoading);
            el.removeEventListener('did-stop-loading', onDidStopLoading);
            el.removeEventListener('did-finish-load', onDidFinishLoad);
            el.removeEventListener('did-fail-load', onDidFailLoad);
            el.removeEventListener('crashed', onCrashed);
            el.removeEventListener('destroyed', onDestroyed);
            el.removeEventListener('console-message', onConsoleMessage);
            el.removeEventListener('dom-ready', onDomReady);
        };
    }, [currentUrl, refreshKey]);

    const handleWebviewError = () => {
        setIsLoading(false);
        const errorMsg = `webview onError 触发, URL: ${currentUrl}`;
        console.error('[BrowserTab]', errorMsg);
        setLoadError(errorMsg);
    };

    const handleOpenExternal = useCallback(async () => {
        if (!currentUrl) return;
        try {
            const fullUrl = ensureProtocol(currentUrl);
            await window.ipcRenderer.invoke('app:open-external-url', fullUrl);
        } catch (error) {
            console.error('Failed to open external URL:', error);
        }
    }, [currentUrl]);

    return (
        <div className="flex flex-col h-full bg-stone-100 dark:bg-zinc-950">
            {/* URL Bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
                <div className="flex items-center gap-0 shrink-0">
                    <button
                        type="button"
                        onClick={handleOpenExternal}
                        disabled={!currentUrl}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="在系统浏览器中打开"
                        aria-label="在系统浏览器中打开"
                    >
                        <ExternalLink size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors"
                        title={t('refresh') || '刷新'}
                        aria-label={t('refresh') || '刷新'}
                        disabled={!currentUrl}
                    >
                        <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('browserUrlPlaceholder') || '输入 URL 或搜索...'}
                    className="flex-1 px-3 py-2 text-sm bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg text-stone-800 dark:text-zinc-200 placeholder-stone-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
                    aria-label={t('browserUrlPlaceholder') || 'URL 地址'}
                />
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 relative overflow-hidden">
                {currentUrl ? (
                    <>
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-stone-50 dark:bg-zinc-900 z-10">
                                <RotateCw size={24} className="animate-spin text-orange-500" />
                            </div>
                        )}
                        {loadError && (
                            <div className="absolute bottom-0 left-0 right-0 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm px-4 py-3 z-20 flex items-start gap-2">
                                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <div className="flex-1">
                                    <p className="font-medium">{loadError}</p>
                                    {loadError.includes('无法连接') && (
                                        <p className="text-xs mt-1 opacity-80">
                                            提示：您可以让 AI 助手启动开发服务器，或手动在终端运行 <code className="px-1 py-0.5 bg-red-100 dark:bg-red-900/40 rounded">npm run dev</code> 或 <code className="px-1 py-0.5 bg-red-100 dark:bg-red-900/40 rounded">pnpm dev</code>
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setLoadError(null)}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/40 rounded transition-colors"
                                    title="关闭"
                                >
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                        )}
                        {/* 使用 webview 以便注入 CSS 缩小 Vite 报错 overlay 字号 */}
                        <webview
                            ref={webviewRef}
                            key={`${currentUrl}-${refreshKey}`}
                            src={currentUrl}
                            className="w-full h-full border-0 min-h-0"
                            style={{ display: 'flex' }}
                            allowpopups
                            onError={handleWebviewError}
                        />
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-stone-400 dark:text-zinc-500 p-6">
                        <Globe size={64} className="mb-6 opacity-30" />
                        <p className="text-xl font-semibold mb-3 text-stone-600 dark:text-zinc-400">{t('browser') || '浏览器预览'}</p>
                        <p className="text-sm text-center max-w-md mb-6 leading-relaxed">
                            {t('browserHint') || '在上方输入 URL 开始浏览，或让 AI 助手启动开发服务器并自动打开预览'}
                        </p>
                        
                        <div className="flex flex-col gap-3 w-full max-w-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    const localhostUrl = 'http://localhost:3000';
                                    setUrl(localhostUrl);
                                    setCurrentUrl(localhostUrl);
                                    setIsLoading(true);
                                }}
                                className="w-full px-4 py-3 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors shadow-sm"
                            >
                                {t('browserOpenLocalhost') || '尝试打开 localhost:3000'}
                            </button>
                            
                            <div className="text-xs text-center text-stone-400 dark:text-zinc-600">
                                <p>常用端口：3000 (React/Next.js)、5173 (Vite)、8080 (Vue CLI)</p>
                            </div>
                        </div>
                        
                        <div className="mt-8 p-4 bg-stone-50 dark:bg-zinc-900/50 rounded-lg border border-stone-200 dark:border-zinc-800 max-w-md">
                            <p className="text-xs font-medium text-stone-600 dark:text-zinc-400 mb-2">💡 使用提示</p>
                            <ul className="text-xs text-stone-500 dark:text-zinc-500 space-y-1.5 list-disc list-inside">
                                <li>直接在上方地址栏输入任何 URL</li>
                                <li>告诉 AI 助手"启动开发服务器"自动打开预览</li>
                                <li>支持实时刷新，代码修改后可手动刷新查看</li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
