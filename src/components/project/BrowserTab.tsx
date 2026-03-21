import { useState, useCallback, useEffect, useRef } from 'react';
import { ExternalLink, RotateCw, Globe, AlertCircle, TerminalSquare } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const DEFAULT_URL = '';
const LOAD_TIMEOUT_MS = 15000;

interface WebviewElement extends HTMLElement {
    src: string;
    loadURL(url: string): Promise<void>;
    reload(): void;
    stop(): void;
    getWebContentsId(): number;
    getURL(): string;
    isLoading(): boolean;
}

interface BrowserTabProps {
    initialUrl?: string;
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

const toLoadableUrl = (url: string): string => {
    if (!url) return url;
    return url.replace(/(https?:\/\/)127\.0\.0\.1(?=[:/]|$)/gi, '$1localhost');
};

export function BrowserTab({ initialUrl = DEFAULT_URL, refreshTrigger = 0 }: BrowserTabProps) {
    const { t } = useI18n();
    const [url, setUrl] = useState(initialUrl || '');
    const [currentUrl, setCurrentUrl] = useState(initialUrl || '');
    const [isLoading, setIsLoading] = useState(!!(initialUrl || '').trim());
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showDevTools, setShowDevTools] = useState(false);
    const [devToolsKey, setDevToolsKey] = useState(0);

    const webviewRef = useRef<WebviewElement | null>(null);
    const devtoolsRef = useRef<WebviewElement | null>(null);
    const lastNavigatedUrl = useRef('');
    const prevRefreshTrigger = useRef(0);
    const webviewReady = useRef(false);
    const pendingRefreshRef = useRef(false);

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
        if (currentUrl && webviewRef.current && webviewReady.current) {
            setIsLoading(true);
            try {
                webviewRef.current.reload();
            } catch {
                setCurrentUrl((u) => u);
            }
        }
    }, [currentUrl]);

    useEffect(() => {
        const fullUrl = initialUrl ? ensureProtocol(initialUrl) : '';
        if (fullUrl) {
            setUrl(fullUrl);
            setCurrentUrl(fullUrl);
            setIsLoading(true);
            setLoadError(null);
        }
    }, [initialUrl]);

    useEffect(() => {
        if (refreshTrigger > 0 && refreshTrigger !== prevRefreshTrigger.current && currentUrl && webviewRef.current) {
            prevRefreshTrigger.current = refreshTrigger;
            setIsLoading(true);
            setLoadError(null);
            if (webviewReady.current) {
                try {
                    webviewRef.current.reload();
                } catch {
                    pendingRefreshRef.current = true;
                }
            } else {
                pendingRefreshRef.current = true;
            }
        }
    }, [refreshTrigger, currentUrl]);

    // Navigate webview when currentUrl changes
    useEffect(() => {
        const wv = webviewRef.current;
        const targetUrl = toLoadableUrl(currentUrl);
        if (!wv || !targetUrl || targetUrl === lastNavigatedUrl.current) return;
        lastNavigatedUrl.current = targetUrl;
        if (webviewReady.current) {
            wv.loadURL(targetUrl).catch(() => {});
        }
    }, [currentUrl]);

    // Webview event listeners
    useEffect(() => {
        const wv = webviewRef.current;
        if (!wv) return;

        const onDomReady = () => {
            webviewReady.current = true;
            if (pendingRefreshRef.current && webviewRef.current) {
                pendingRefreshRef.current = false;
                try {
                    webviewRef.current.reload();
                } catch {}
            }
        };
        const onStartLoading = () => {
            setIsLoading(true);
            setLoadError(null);
        };
        const onStopLoading = () => {
            setIsLoading(false);
        };
        const onFailLoad = (e: Event & { errorCode?: number; errorDescription?: string; validatedURL?: string }) => {
            if (e.errorCode === -3) return; // Aborted
            setIsLoading(false);
            if (e.errorCode === -102 || e.errorCode === -106) {
                setLoadError(`无法连接到 ${currentUrl}。请确保开发服务器正在运行。`);
            } else if (e.errorCode !== undefined) {
                setLoadError(`加载失败 (${e.errorCode}): ${e.errorDescription || ''}`);
            }
        };
        const onDidNavigate = (e: Event & { url?: string }) => {
            if (e.url) setUrl(e.url);
        };

        wv.addEventListener('dom-ready', onDomReady);
        wv.addEventListener('did-start-loading', onStartLoading);
        wv.addEventListener('did-stop-loading', onStopLoading);
        wv.addEventListener('did-fail-load', onFailLoad as EventListener);
        wv.addEventListener('did-navigate', onDidNavigate as EventListener);

        return () => {
            wv.removeEventListener('dom-ready', onDomReady);
            wv.removeEventListener('did-start-loading', onStartLoading);
            wv.removeEventListener('did-stop-loading', onStopLoading);
            wv.removeEventListener('did-fail-load', onFailLoad as EventListener);
            wv.removeEventListener('did-navigate', onDidNavigate as EventListener);
        };
    }, [currentUrl]);

    // Load timeout
    useEffect(() => {
        if (!isLoading || !currentUrl) return;
        const timer = setTimeout(() => {
            setIsLoading(false);
            setLoadError('timeout');
        }, LOAD_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [isLoading, currentUrl]);

    // Connect DevTools webview after it mounts
    useEffect(() => {
        if (!showDevTools) return;
        const devtools = devtoolsRef.current;
        const page = webviewRef.current;
        if (!devtools || !page) return;

        const connectDevTools = async () => {
            try {
                const pageWcId = page.getWebContentsId();
                const devtoolsWcId = devtools.getWebContentsId();
                if (pageWcId && devtoolsWcId) {
                    await window.ipcRenderer.invoke('browser:open-devtools', pageWcId, devtoolsWcId);
                }
            } catch (e) {
                console.error('[BrowserTab] Failed to connect devtools:', e);
            }
        };

        devtools.addEventListener('dom-ready', connectDevTools, { once: true });
        return () => devtools.removeEventListener('dom-ready', connectDevTools);
    }, [showDevTools, devToolsKey]);

    const toggleDevTools = useCallback(async () => {
        if (showDevTools) {
            const wv = webviewRef.current;
            if (wv) {
                try {
                    await window.ipcRenderer.invoke('browser:close-devtools', wv.getWebContentsId());
                } catch {}
            }
            setShowDevTools(false);
        } else {
            setDevToolsKey(prev => prev + 1);
            setShowDevTools(true);
        }
    }, [showDevTools]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleNavigate();
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

    const setWebviewRef = useCallback((node: HTMLElement | null) => {
        webviewRef.current = node as WebviewElement | null;
        webviewReady.current = false;
    }, []);

    const setDevtoolsRef = useCallback((node: HTMLElement | null) => {
        devtoolsRef.current = node as WebviewElement | null;
    }, []);

    return (
        <div className="flex flex-col h-full min-w-[390px] bg-stone-100 dark:bg-zinc-900">
            {/* URL Bar */}
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
                        className="p-1.5 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                {currentUrl && (
                    <button
                        type="button"
                        onClick={toggleDevTools}
                        className={`shrink-0 p-1.5 rounded transition-colors ${
                            showDevTools
                                ? 'text-orange-500 bg-orange-50 dark:bg-orange-500/10'
                                : 'text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300'
                        }`}
                        title="开发者工具"
                        aria-label="开发者工具"
                    >
                        <TerminalSquare size={16} />
                    </button>
                )}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 min-h-0 relative overflow-hidden pr-2 bg-stone-100 dark:bg-zinc-900 flex flex-col">
                {currentUrl ? (
                    <>
                        {/* Page preview area */}
                        <div className={`relative min-h-0 ${showDevTools ? 'h-[55%]' : 'h-full'}`}>
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
                            <webview
                                ref={setWebviewRef}
                                src={toLoadableUrl(currentUrl)}
                                style={{ width: '100%', height: '100%', display: loadError ? 'none' : 'flex' }}
                            />
                        </div>

                        {/* DevTools panel */}
                        {showDevTools && (
                            <div className="h-[45%] min-h-[120px] border-t-2 border-stone-300 dark:border-zinc-600 bg-white dark:bg-zinc-900">
                                <webview
                                    key={devToolsKey}
                                    ref={setDevtoolsRef}
                                    src="about:blank"
                                    style={{ width: '100%', height: '100%' }}
                                />
                            </div>
                        )}
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
