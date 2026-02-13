import { useState, useCallback, useEffect, useRef } from 'react';
import { ExternalLink, RotateCw, Globe, AlertCircle } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_URL = ''; // 默认为空，避免启动时立即尝试连接
const LOAD_TIMEOUT_MS = 10000; // 10 秒加载超时（主进程检测到 ERR_CONNECTION_REFUSED 时会提前通知）

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

/** 用于 URL 比较：localhost 与 127.0.0.1 视为等价 */
const urlHostEquivalent = (a: string, b: string): boolean => {
    const norm = (u: string) =>
        ensureProtocol(u || '')
            .replace(/\/$/, '')
            .replace(/(https?:\/\/)localhost(?=[:/]|$)/gi, '$1127.0.0.1');
    return norm(a) === norm(b);
};

/** macOS 上 Vite 可能只绑定 ::1，127.0.0.1 无法访问。将 127.0.0.1 转为 localhost 以兼容 */
const toLoadableUrl = (url: string): string => {
    if (!url) return url;
    return url.replace(/(https?:\/\/)127\.0\.0\.1(?=[:/]|$)/gi, '$1localhost');
};

export function BrowserTab({ initialUrl = DEFAULT_URL, refreshTrigger = 0 }: BrowserTabProps) {
    const { t } = useI18n();
    const [url, setUrl] = useState(initialUrl || '');
    const [currentUrl, setCurrentUrl] = useState(initialUrl || '');
    const [isLoading, setIsLoading] = useState(!!(initialUrl || '').trim());
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadError, setLoadError] = useState<string | null>(null);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    const handleNavigate = useCallback(() => {
        const fullUrl = ensureProtocol(url);
        if (fullUrl) {
            setUrl(fullUrl);
            setCurrentUrl(fullUrl);
            setIsLoading(true);
            setLoadError(null);
        }
    }, [url]);

    const handleRefresh = useCallback(() => {
        setLoadError(null);
        if (currentUrl) {
            setIsLoading(true);
            setRefreshKey(prev => prev + 1);
        }
    }, [currentUrl]);

    // 当父组件更新 URL（如 Agent 调用 open_browser_preview）时同步，保持 localhost / 127.0.0.1 原样
    useEffect(() => {
        const fullUrl = initialUrl ? ensureProtocol(initialUrl) : '';
        if (fullUrl) {
            setUrl(fullUrl);
            setCurrentUrl(fullUrl);
            setIsLoading(true);
            setLoadError(null);
        }
    }, [initialUrl]);

    // 外部刷新触发器（如对话完成后自动刷新）
    useEffect(() => {
        if (refreshTrigger > 0 && currentUrl) {
            setIsLoading(true);
            setLoadError(null);
            setRefreshKey(prev => prev + 1);
        }
    }, [refreshTrigger, currentUrl]);

    // 加载超时：长时间未 onload 时显示友好提示
    useEffect(() => {
        if (!isLoading || !currentUrl) return;
        const timer = setTimeout(() => {
            setIsLoading(false);
            setLoadError('timeout');
        }, LOAD_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [isLoading, currentUrl, refreshKey]);

    // 主进程检测到 iframe ERR_CONNECTION_REFUSED 时立即显示错误，无需等待超时
    useEffect(() => {
        const remove = window.ipcRenderer.on('agent:iframe-load-failed', (_event, ...args) => {
            const failedUrl = args[0] as string;
            if (urlHostEquivalent(failedUrl, currentUrl)) {
                setIsLoading(false);
                setLoadError(`无法连接到 ${currentUrl}。请确保开发服务器正在运行。`);
            }
        });
        return remove;
    }, [currentUrl]);

    const handleIframeLoad = useCallback(() => {
        setIsLoading(false);
        setLoadError(null);
    }, []);

    const handleIframeError = useCallback(() => {
        setIsLoading(false);
        setLoadError(`无法连接到 ${currentUrl}。请确保开发服务器正在运行。`);
    }, [currentUrl]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNavigate();
        }
    };

    const handleOpenExternal = useCallback(async () => {
        if (!currentUrl) return;
        try {
            const fullUrl = toLoadableUrl(ensureProtocol(currentUrl));
            await window.ipcRenderer.invoke('app:open-external-url', fullUrl);
        } catch (error) {
            console.error('Failed to open external URL:', error);
        }
    }, [currentUrl]);

    return (
        <div className="flex flex-col h-full min-w-[390px] bg-stone-100 dark:bg-zinc-900">
            {/* URL Bar：底边 border 右侧留 pr-2 间距 */}
            <div className="shrink-0 flex">
                <div className="flex-1 flex items-center gap-2 py-2 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mr-2">
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
            </div>

            {/* Content Area：右侧留出间距，与资源管理器分隔更美观；背景与 URL 栏/资源管理器统一 */}
            <div className="flex-1 min-h-0 relative overflow-hidden pr-2 bg-stone-100 dark:bg-zinc-900">
                {currentUrl ? (
                    <>
                        {isLoading && !loadError && (
                            <div className="absolute inset-0 flex items-center justify-center bg-stone-50 dark:bg-zinc-900 z-10">
                                <RotateCw size={24} className="animate-spin text-orange-500" />
                            </div>
                        )}
                        {loadError ? (
                            <div
                                className="absolute inset-0 flex flex-col items-center justify-center bg-stone-50 dark:bg-zinc-900 p-8 z-20"
                                role="alert"
                                aria-live="polite"
                            >
                                <AlertCircle size={64} className="mb-6 text-amber-500 dark:text-amber-400 opacity-80" aria-hidden />
                                <h2 className="text-xl font-semibold text-stone-700 dark:text-zinc-300 mb-2">
                                    {loadError === 'timeout'
                                        ? (t('browserLoadTimeout') || '页面加载超时')
                                        : (t('browserLoadFailed') || '页面加载失败')}
                                </h2>
                                <p className="text-sm text-stone-500 dark:text-zinc-500 text-center max-w-md mb-6">
                                    {loadError === 'timeout'
                                        ? (t('browserLoadTimeoutHint') || '开发服务器可能未启动，请在终端运行 npm run dev 或 pnpm dev。')
                                        : (t('browserLoadFailedHint') || '请确保开发服务器已启动，或让 AI 助手帮您启动。')}
                                </p>
                                {loadError !== 'timeout' && (
                                    <p className="text-xs text-stone-400 dark:text-zinc-600 text-center max-w-md mb-6">
                                        {loadError}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-3 justify-center">
                                    <button
                                        type="button"
                                        onClick={handleOpenExternal}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
                                        aria-label="在系统浏览器中打开"
                                    >
                                        <ExternalLink size={16} />
                                        {t('browserOpenInSystem') || '在系统浏览器中打开'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleRefresh}
                                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200 border border-stone-300 dark:border-zinc-600 rounded-lg transition-colors"
                                        aria-label={t('browserRetry') || '重试'}
                                    >
                                        <RotateCw size={16} />
                                        {t('browserRetry') || '重试'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setLoadError(null)}
                                        className="px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200 border border-stone-300 dark:border-zinc-600 rounded-lg transition-colors"
                                        aria-label={t('browserClose') || '关闭'}
                                    >
                                        {t('browserClose') || '关闭'}
                                    </button>
                                </div>
                                <div className="mt-8 p-4 bg-stone-100 dark:bg-zinc-800/50 rounded-lg border border-stone-200 dark:border-zinc-700 max-w-md">
                                    <p className="text-xs font-medium text-stone-600 dark:text-zinc-400 mb-2">💡 {t('browserSuggestionsTitle') || '解决建议'}</p>
                                    <ul className="text-xs text-stone-500 dark:text-zinc-500 space-y-1.5 list-disc list-inside">
                                        <li>{t('browserSuggestion1') || '在终端运行 npm run dev 或 pnpm dev 启动开发服务器'}</li>
                                        <li>{t('browserSuggestion2') || '告诉 AI 助手「启动开发服务器」自动打开预览'}</li>
                                        <li>{t('browserSuggestion3') || '确认端口正确（常见：3000、5173、8080）'}</li>
                                    </ul>
                                </div>
                            </div>
                        ) : null}
                        <iframe
                            ref={iframeRef}
                            key={`${currentUrl}-${refreshKey}`}
                            src={toLoadableUrl(currentUrl)}
                            className="w-full h-full border-0 min-h-0"
                            style={{ display: loadError ? 'none' : 'block' }}
                            sandbox="allow-scripts allow-same-origin"
                            referrerPolicy="no-referrer"
                            title={t('browserPreview') || '浏览器预览'}
                            onLoad={handleIframeLoad}
                            onError={handleIframeError}
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
