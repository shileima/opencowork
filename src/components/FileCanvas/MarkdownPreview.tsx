/**
 * Markdown 预览组件
 * Markdown Preview
 *
 * 渲染 Markdown 文档，支持源码和预览切换
 */

import { useState } from 'react';
import { FileText, Eye, Edit3 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { MarkdownRenderer } from '../MarkdownRenderer';

interface MarkdownPreviewProps {
    content: string;
    filePath: string;
}

export function MarkdownPreview({ content, filePath }: MarkdownPreviewProps) {
    const { t } = useI18n();
    const [mode, setMode] = useState<'preview' | 'source'>('preview');

    console.log('[MarkdownPreview] Rendering, filePath:', filePath, 'mode:', mode, 'contentLength:', content?.length);

    // 获取文件名
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-2">
                    <FileText size={16} className="text-blue-500" />
                    <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        {fileName}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-medium">
                        Markdown
                    </span>
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={() => setMode('preview')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all ${
                            mode === 'preview'
                                ? 'bg-blue-500 text-white shadow-sm'
                                : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-700'
                        }`}
                    >
                        <Eye size={13} />
                        {t('preview')}
                    </button>
                    <button
                        onClick={() => setMode('source')}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg transition-all ${
                            mode === 'source'
                                ? 'bg-blue-500 text-white shadow-sm'
                                : 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-200 dark:hover:bg-zinc-700'
                        }`}
                    >
                        <Edit3 size={13} />
                        {t('source')}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                {mode === 'preview' ? (
                    <div className="p-6">
                        <MarkdownRenderer content={content} isDark={document.documentElement.classList.contains('dark')} />
                    </div>
                ) : (
                    <div className="p-4">
                        <pre className="text-xs leading-relaxed bg-stone-50 dark:bg-zinc-900/50 rounded-lg p-4 border border-stone-200 dark:border-zinc-800">
                            <code>{content}</code>
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
