/**
 * 文件预览组件
 * File Preview
 *
 * 根据文件类型显示不同的预览方式
 */

import { useState, useEffect } from 'react';
import { AlertCircle, File } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';
import { SourceCodePreview } from './SourceCodePreview';
import { MarkdownPreview } from './MarkdownPreview';
import { ImagePreview } from './ImagePreview';
import { HTMLPreview } from './HTMLPreview';
import { PDFPreview } from './PDFPreview';

interface FilePreviewProps {
    filePath: string;
    sessionId: string | null;
}

export function FilePreview({ filePath, sessionId: _sessionId }: FilePreviewProps) {
    const { t } = useI18n();
    const [content, setContent] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // 获取文件扩展名
    const extension = filePath.split('.').pop()?.toLowerCase() || '';

    // 判断文件类型
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'].includes(extension);
    const isMarkdown = extension === 'md';
    const isHTML = ['html', 'htm'].includes(extension);
    const isPDF = extension === 'pdf';
    const isWord = ['doc', 'docx'].includes(extension);
    const isExcel = ['xls', 'xlsx'].includes(extension);
    const isPowerPoint = ['ppt', 'pptx'].includes(extension);

    // 加载文件内容
    useEffect(() => {
        loadFile();
    }, [filePath]);

    const loadFile = async () => {
        setLoading(true);
        setError(null);

        try {
            console.log('[FilePreview] Loading file:', filePath);
            const result = await window.ipcRenderer.invoke('file:read', filePath) as {
                success: boolean;
                content?: string;
                isBinary?: boolean;
                error?: string;
            };
            console.log('[FilePreview] Load result:', result);

            if (result.success && result.content) {
                console.log('[FilePreview] Content loaded, length:', result.content.length, 'isBinary:', result.isBinary);
                setContent(result.content);
            } else {
                logger.error('[FilePreview] Failed to load:', result.error);
                setError(result.error || 'Failed to load file');
            }
        } catch (err) {
            logger.error('[FilePreview] Exception:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    // 显示加载状态
    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-stone-500 dark:text-zinc-400 text-sm">{t('loading')}</div>
            </div>
        );
    }

    // 显示错误
    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-red-500 text-sm">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            </div>
        );
    }

    // 图片预览
    if (isImage) {
        console.log('[FilePreview] Rendering image preview');
        return <ImagePreview filePath={filePath} content={content} />;
    }

    // PDF 预览（使用 blob URL）
    if (isPDF) {
        console.log('[FilePreview] Rendering PDF preview');
        return <PDFPreview filePath={filePath} content={content} />;
    }

    // Word 文档（显示提示）
    if (isWord) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center p-6">
                    <File size={48} className="mx-auto text-blue-500 mb-4" />
                    <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-300 mb-2">
                        {t('wordDocPreview')}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                        {t('previewNotSupported')}
                    </p>
                </div>
            </div>
        );
    }

    // Excel 文档（显示提示）
    if (isExcel) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center p-6">
                    <File size={48} className="mx-auto text-green-500 mb-4" />
                    <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-300 mb-2">
                        {t('excelSheetPreview')}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                        {t('previewNotSupported')}
                    </p>
                </div>
            </div>
        );
    }

    // PowerPoint 文档（显示提示）
    if (isPowerPoint) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center p-6">
                    <File size={48} className="mx-auto text-orange-500 mb-4" />
                    <h3 className="text-sm font-semibold text-stone-700 dark:text-zinc-300 mb-2">
                        {t('pptSlidePreview')}
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                        {t('previewNotSupported')}
                    </p>
                </div>
            </div>
        );
    }

    // Markdown 预览
    if (isMarkdown) {
        console.log('[FilePreview] Rendering markdown preview');
        return <MarkdownPreview content={content} filePath={filePath} />;
    }

    // HTML 预览
    if (isHTML) {
        console.log('[FilePreview] Rendering HTML preview');
        return <HTMLPreview filePath={filePath} content={content} />;
    }

    // 代码/文本预览
    console.log('[FilePreview] Rendering source code preview, extension:', extension);
    return (
        <SourceCodePreview
            content={content}
            filePath={filePath}
            language={getLanguage(extension)}
        />
    );

    // 根据扩展名获取语言名称
    function getLanguage(ext: string): string {
        const languageMap: Record<string, string> = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'c',
            'cs': 'csharp',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'sh': 'shell',
            'bash': 'bash',
            'zsh': 'shell',
            'json': 'json',
            'xml': 'xml',
            'yaml': 'yaml',
            'yml': 'yaml',
            'toml': 'toml',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'sql': 'sql',
            'graphql': 'graphql',
            'txt': 'text',
            'log': 'text'
        };

        return languageMap[ext] || 'text';
    }
}
