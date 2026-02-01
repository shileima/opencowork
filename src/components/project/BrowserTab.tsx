import { useState, useCallback, useEffect, useRef } from 'react';
import { Globe, RotateCw } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_URL = 'http://localhost:3000';

interface BrowserTabProps {
    initialUrl?: string;
    /** 外部刷新触发器：数值变化时强制刷新 iframe */
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
    const [refreshKey, setRefreshKey] = useState(0); // 用于强制刷新 iframe
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const handleNavigate = useCallback(() => {
        const fullUrl = ensureProtocol(url);
        if (fullUrl) {
            setCurrentUrl(fullUrl);
            setIsLoading(true);
        }
    }, [url]);

    const handleRefresh = useCallback(() => {
        if (iframeRef.current) {
            setIsLoading(true);
            // 强制刷新 iframe
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

    const handleIframeLoad = () => {
        setIsLoading(false);
    };

    const handleIframeError = () => {
        setIsLoading(false);
        console.error('Failed to load URL:', currentUrl);
    };

    return (
        <div className="flex flex-col h-full bg-stone-100 dark:bg-zinc-950">
            {/* URL Bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
                <Globe size={16} className="text-stone-400 dark:text-zinc-500 shrink-0" />
                <button
                    type="button"
                    onClick={handleRefresh}
                    className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors shrink-0"
                    title={t('refresh') || '刷新'}
                    aria-label={t('refresh') || '刷新'}
                    disabled={!currentUrl}
                >
                    <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} />
                </button>
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
                        <iframe
                            ref={iframeRef}
                            key={`${currentUrl}-${refreshKey}`}
                            src={currentUrl}
                            title={t('browserPreview') || '页面预览'}
                            className="w-full h-full border-0"
                            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
                            onLoad={handleIframeLoad}
                            onError={handleIframeError}
                            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
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
