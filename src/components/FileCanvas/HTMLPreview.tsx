/**
 * HTML 交互预览组件
 * HTML Preview
 *
 * 使用 iframe + blob URL 显示 HTML，支持交互
 */

import { useState, useEffect } from 'react';
import { Globe, AlertCircle, RefreshCw, ExternalLink, Download } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';

interface HTMLPreviewProps {
    filePath: string;
    content: string;
}

export function HTMLPreview({ filePath, content }: HTMLPreviewProps) {
    const { t } = useI18n();
    const [error, setError] = useState<string | null>(null);
    const [blobUrl, setBlobUrl] = useState<string>('');
    const [reloadKey, setReloadKey] = useState(0);

    console.log('[HTMLPreview] Rendering, filePath:', filePath, 'contentLength:', content?.length);

    const handleReload = () => {
        setReloadKey(prev => prev + 1);
    };

    // 在外部应用中打开
    const handleOpenExternal = () => {
        window.ipcRenderer.invoke('shell:open-path', filePath);
    };

    // 下载文件
    const handleDownload = () => {
        if (blobUrl) {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filePath.split(/[/\\]/).pop() || 'document.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    // 创建 blob URL
    useEffect(() => {
        if (!content) {
            setBlobUrl('');
            return;
        }

        console.log('[HTMLPreview] Creating blob URL, reloadKey:', reloadKey);

        try {
            // 清理旧的 blob URL
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
            }

            // 创建新的 blob URL
            const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            setBlobUrl(url);

            // 清理函数
            return () => {
                if (url) {
                    URL.revokeObjectURL(url);
                }
            };
        } catch (err) {
            logger.error('[HTMLPreview] Failed to create blob URL:', err);
            setError('Failed to load HTML file');
        }
    }, [content, filePath, reloadKey]);

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center p-6">
                    <AlertCircle size={48} className="mx-auto text-red-500 mb-4" />
                    <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-300 mb-2">
                        {t('cannotLoadFile')}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-zinc-400 mb-4">
                        {error}
                    </p>
                    <button
                        onClick={handleOpenExternal}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
                    >
                        <ExternalLink size={14} />
                        {t('openInFileManager')}
                    </button>
                </div>
            </div>
        );
    }

    if (!content || !blobUrl) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-stone-500 dark:text-zinc-400 text-sm">{t('loading')}</div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2">
                    <Globe size={16} className="text-orange-500" />
                    <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        {filePath.split(/[/\\]/).pop()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full font-medium">
                        HTML
                    </span>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={handleReload}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-700"
                        title={t('refresh')}
                    >
                        <RefreshCw size={13} />
                        {t('refresh')}
                    </button>
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-700"
                        title={t('download')}
                    >
                        <Download size={13} />
                        {t('download')}
                    </button>
                    <button
                        onClick={handleOpenExternal}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-700"
                        title={t('openInFileManager')}
                    >
                        <ExternalLink size={13} />
                        {t('openInExplorer')}
                    </button>
                </div>
            </div>

            {/* iframe 预览 */}
            <div className="flex-1 bg-stone-100 dark:bg-zinc-950">
                <iframe
                    key={blobUrl}
                    src={blobUrl}
                    className="w-full h-full border-0"
                    title="HTML Preview"
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
                />
            </div>
        </div>
    );
}
