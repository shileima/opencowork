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
    const webviewRef = useRef<HTMLElement | null>(null);

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
        if (!currentUrl || !el) return;
        const onDidFinishLoad = () => {
            setIsLoading(false);
            try {
                (el as unknown as { insertCSS: (css: string) => void }).insertCSS(VITE_ERROR_OVERLAY_CSS);
            } catch {
                // ignore
            }
        };
        el.addEventListener('did-finish-load', onDidFinishLoad);
        return () => el.removeEventListener('did-finish-load', onDidFinishLoad);
    }, [currentUrl, refreshKey]);

    const handleWebviewError = () => {
        setIsLoading(false);
        console.error('Failed to load URL:', currentUrl);
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
