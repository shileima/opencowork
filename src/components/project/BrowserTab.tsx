import { useState, useCallback, useEffect, useRef } from 'react';
import { ExternalLink, RotateCw, Globe } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_URL = 'http://localhost:3000';

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
            setLoadError(`加载失败 (${errorCode}): ${errorDescription} - ${validatedURL}`);
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
                            <div className="absolute bottom-0 left-0 right-0 bg-red-500/90 text-white text-xs px-3 py-2 z-20 font-mono break-all">
                                {loadError}
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
                        <Globe size={48} className="mb-4 opacity-50" />
                        <p className="text-lg font-medium mb-2">{t('browser') || '浏览器'}</p>
                        <p className="text-sm text-center max-w-xs">
                            {t('browserHint') || '在上方输入 URL，或让 AI 助手启动开发服务器并导航到此页面'}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                setUrl(DEFAULT_URL);
                                setCurrentUrl(DEFAULT_URL);
                                setIsLoading(true);
                            }}
                            className="mt-4 px-4 py-2 text-sm font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-lg transition-colors"
                        >
                            {t('browserOpenLocalhost') || '打开 localhost:3000'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
