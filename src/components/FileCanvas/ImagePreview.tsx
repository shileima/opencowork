/**
 * 图片预览组件
 * Image Preview
 *
 * 显示图片文件，支持缩放
 */

import { useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCw, Download, Maximize2, X } from 'lucide-react';

interface ImagePreviewProps {
    filePath: string;
    content?: string; // base64 编码的图片内容
}

export function ImagePreview({ filePath, content }: ImagePreviewProps) {
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const handleZoomIn = useCallback(() => {
        setScale(prev => Math.min(prev + 0.25, 3));
    }, []);

    const handleZoomOut = useCallback(() => {
        setScale(prev => Math.max(prev - 0.25, 0.25));
    }, []);

    const handleRotate = useCallback(() => {
        setRotation(prev => (prev + 90) % 360);
    }, []);

    const handleReset = useCallback(() => {
        setScale(1);
        setRotation(0);
    }, []);

    const handleDownload = useCallback(() => {
        const link = document.createElement('a');
        link.href = `file://${filePath}`;
        link.download = filePath.split('/').pop() || 'image';
        link.click();
    }, [filePath]);

    const handleError = () => {
        setError('Failed to load image');
    };

    const transformStyle = {
        transform: `scale(${scale}) rotate(${rotation}deg)`,
        transition: 'transform 0.3s ease'
    };

    // 获取图片源：优先使用 base64 content，否则使用 file:// 协议
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    const imageSrc = content ? `data:image/${extension};base64,${content}` : `file://${filePath.replace(/\\/g, '/')}`;

    console.log('[ImagePreview] Rendering image, extension:', extension, 'hasContent:', !!content);

    return (
        <div className="h-full flex flex-col bg-stone-50 dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    <button onClick={handleZoomOut} className="p-1 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded" title="Zoom Out">
                        <ZoomOut size={16} className="text-stone-600 dark:text-zinc-400" />
                    </button>
                    <button onClick={handleZoomIn} className="p-1 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded" title="Zoom In">
                        <ZoomIn size={16} className="text-stone-600 dark:text-zinc-400" />
                    </button>
                    <span className="text-xs font-medium text-stone-700 dark:text-zinc-300 min-w-[60px] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button onClick={handleRotate} className="p-1 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded" title="Rotate">
                        <RotateCw size={16} className="text-stone-600 dark:text-zinc-400" />
                    </button>
                    <button onClick={handleReset} className="p-1 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded" title="Reset">
                        <Maximize2 size={16} className="text-stone-600 dark:text-zinc-400" />
                    </button>
                </div>
                <button
                    onClick={handleDownload}
                    className="p-1 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded"
                    title="Download"
                >
                    <Download size={16} className="text-stone-600 dark:text-zinc-400" />
                </button>
            </div>

            {/* Image Display */}
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                {error ? (
                    <div className="text-red-500 text-sm flex items-center gap-2">
                        <X size={16} />
                        <span>{error}</span>
                    </div>
                ) : (
                    <img
                        src={imageSrc}
                        alt="Preview"
                        className="max-w-full max-h-full object-contain"
                        style={transformStyle}
                        onError={handleError}
                    />
                )}
            </div>
        </div>
    );
}
