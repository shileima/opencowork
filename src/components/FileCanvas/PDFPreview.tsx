/**
 * PDF 预览组件
 * PDF Preview
 *
 * 使用 iframe + blob URL 显示 PDF
 */

import { useState, useEffect, useRef } from 'react';
import { File, AlertCircle, Download, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';

interface PDFPreviewProps {
    filePath: string;
    content: string;
}

export function PDFPreview({ filePath, content }: PDFPreviewProps) {
    const { t } = useI18n();
    const [error, setError] = useState<string | null>(null);
    const [blobUrl, setBlobUrl] = useState<string>('');
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        console.log('[PDFPreview] Processing PDF, filePath:', filePath, 'contentLength:', content?.length);

        try {
            // 将 base64 内容转换为 blob URL
            if (content) {
                // 检查是否是 base64 编码
                const base64Match = content.match(/^data:application\/pdf;base64,(.+)$/);
                if (base64Match) {
                    // 如果是 data URL，直接使用
                    setBlobUrl(content);
                } else {
                    // 如果是纯 base64 字符串，添加 data URI 前缀
                    const byteCharacters = atob(content);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    setBlobUrl(url);

                    // 清理函数
                    return () => {
                        URL.revokeObjectURL(url);
                    };
                }
            }
        } catch (err) {
            logger.error('[PDFPreview] Failed to process PDF:', err);
            setError('Failed to load PDF file');
        }
    }, [content, filePath]);

    // 在外部应用中打开
    const handleOpenExternal = () => {
        window.ipcRenderer.invoke('shell:open-path', filePath);
    };

    // 下载文件
    const handleDownload = () => {
        if (blobUrl) {
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filePath.split(/[/\\]/).pop() || 'document.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

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

    if (!blobUrl) {
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
                    <File size={16} className="text-red-500" />
                    <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        {filePath.split(/[/\\]/).pop()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full font-medium">
                        PDF
                    </span>
                </div>
                <div className="flex gap-1">
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

            {/* PDF Viewer */}
            <div className="flex-1 bg-stone-100 dark:bg-zinc-950">
                <iframe
                    ref={iframeRef}
                    src={blobUrl}
                    className="w-full h-full border-0"
                    title="PDF Preview"
                />
            </div>
        </div>
    );
}
