import { useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { GripVertical } from 'lucide-react';

interface ResizableSplitPaneProps {
    leftPanel: ReactNode;
    rightPanel: ReactNode;
    initialRatio?: number; // 初始分割比例（0-100，表示左侧面板的百分比宽度）
    onRatioChange?: (ratio: number) => void;
    minSize?: number; // 最小宽度百分比（默认 20）
}

export function ResizableSplitPane({
    leftPanel,
    rightPanel,
    initialRatio = 50,
    onRatioChange,
    minSize = 20
}: ResizableSplitPaneProps) {
    const [leftRatio, setLeftRatio] = useState(initialRatio);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ startPos: number; startRatio: number } | null>(null);

    // 同步 initialRatio 变化
    useEffect(() => {
        setLeftRatio(initialRatio);
    }, [initialRatio]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startPos = e.clientX;
        dragStateRef.current = { startPos, startRatio: leftRatio };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        // 防止拖拽时文本选择
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    }, [leftRatio]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragStateRef.current || !containerRef.current) return;
        const { startPos, startRatio } = dragStateRef.current;
        const delta = e.clientX - startPos;
        const containerWidth = containerRef.current.clientWidth;
        const deltaPercent = (delta / containerWidth) * 100;

        const newLeftRatio = startRatio + deltaPercent;
        const newRightRatio = 100 - newLeftRatio;

        // 限制最小宽度
        if (newLeftRatio >= minSize && newRightRatio >= minSize) {
            setLeftRatio(newLeftRatio);
            onRatioChange?.(newLeftRatio);
        }
    }, [minSize, onRatioChange]);

    const handleMouseUp = useCallback(() => {
        dragStateRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // 恢复文本选择和光标
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }, [handleMouseMove]);

    return (
        <div
            ref={containerRef}
            className="flex flex-row h-full w-full min-h-0"
        >
            {/* 左侧面板 */}
            <div
                className="relative min-h-0 min-w-0 flex flex-col"
                style={{ width: `${leftRatio}%` }}
            >
                {leftPanel}
            </div>

            {/* 分割线：与主题同色背景，无黑边；视觉细线 + 足够拖拽区域 */}
            <div
                className="relative w-2 flex-shrink-0 flex items-center justify-center cursor-col-resize group bg-stone-50 dark:bg-zinc-900"
                onMouseDown={handleMouseDown}
            >
                <div className="w-px h-full bg-stone-200 dark:bg-zinc-700 group-hover:bg-stone-300 dark:group-hover:bg-zinc-600 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical size={12} className="text-stone-500 dark:text-zinc-400" />
                </div>
            </div>

            {/* 右侧面板 */}
            <div
                className="relative min-h-0 min-w-0 flex-1 flex flex-col"
            >
                {rightPanel}
            </div>
        </div>
    );
}
