/**
 * 源代码预览组件
 * Source Code Preview
 *
 * 显示代码文件，支持语法高亮
 */

import { useState } from 'react';
import { Copy, Check, Code } from 'lucide-react';
import { logger } from '../../services/logger';

interface SourceCodePreviewProps {
    content: string;
    filePath: string;
    language: string;
}

export function SourceCodePreview({ content, filePath, language }: SourceCodePreviewProps) {
    const [copied, setCopied] = useState(false);

    console.log('[SourceCodePreview] Rendering, filePath:', filePath, 'language:', language, 'contentLength:', content?.length);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            logger.error('Failed to copy:', error);
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    <Code size={16} className="text-stone-500" />
                    <span className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                        {filePath.split('/').pop()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 dark:bg-zinc-800 rounded text-stone-500 dark:text-zinc-400">
                        {language}
                    </span>
                </div>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded transition-colors"
                >
                    {copied ? (
                        <>
                            <Check size={12} className="text-green-600" />
                            Copied!
                        </>
                    ) : (
                        <>
                            <Copy size={12} />
                            Copy
                        </>
                    )}
                </button>
            </div>

            {/* Code Content */}
            <div className="flex-1 overflow-auto p-4">
                <pre className="text-xs leading-relaxed">
                    <code>{content}</code>
                </pre>
            </div>
        </div>
    );
}
