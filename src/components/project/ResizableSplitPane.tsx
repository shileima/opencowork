import { useState, useRef, useCallback, ReactNode, useEffect } from 'react';
import { GripVertical } from 'lucide-react';

interface ResizableSplitPaneProps {
    leftPanel: ReactNode;
    rightPanel: ReactNode;
    initialRatio?: number; // 初始分割比例（0-100，表示左侧面板的百分比宽度）
    onRatioChange?: (ratio: number) => void;
    minSize?: number; // 最小宽度百分比（默认 20）
    /** 左侧面板最小宽度（像素），拖拽时保证不小于该值 */
    leftMinSizePx?: number;
    /** 右侧面板最小宽度（像素），拖拽时保证不小于该值 */
    rightMinSizePx?: number;
}

export function ResizableSplitPane({
    leftPanel,
    rightPanel,
    initialRatio = 50,
    onRatioChange,
    minSize = 20,
    leftMinSizePx,
    rightMinSizePx
}: ResizableSplitPaneProps) {
    const [leftRatio, setLeftRatio] = useState(initialRatio);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<boolean>(false);

    // 同步 initialRatio 变化
    useEffect(() => {
        setLeftRatio(initialRatio);
    }, [initialRatio]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!containerRef.current || !dragStateRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width <= 0) return;

        // 根据当前光标在容器内的位置计算比例，使分割线始终贴在光标下
        let newLeftRatio = ((e.clientX - rect.left) / rect.width) * 100;

        // 左侧最小宽度百分比（保证 leftMinSizePx 像素）
        const leftMinPct =
            leftMinSizePx != null && rect.width > 0
                ? Math.min(100 - minSize, (leftMinSizePx / rect.width) * 100)
                : minSize;
        const effectiveLeftMin = Math.max(minSize, leftMinPct);

        // 右侧最小宽度百分比（保证 rightMinSizePx 像素）
        const rightMinPct =
            rightMinSizePx != null && rect.width > 0
                ? Math.min(100 - minSize, (rightMinSizePx / rect.width) * 100)
                : minSize;
        const effectiveRightMin = Math.max(minSize, rightMinPct);

        const leftMax = 100 - effectiveRightMin;
        newLeftRatio = Math.max(effectiveLeftMin, Math.min(leftMax, newLeftRatio));

        setLeftRatio(newLeftRatio);
        onRatioChange?.(newLeftRatio);
    }, [minSize, onRatioChange, leftMinSizePx, rightMinSizePx]);

    const handleMouseUp = useCallback(() => {
        if (!dragStateRef.current) return;
        dragStateRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove, true);
        document.removeEventListener('mouseup', handleMouseUp, true);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }, [handleMouseMove]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragStateRef.current = true;
        // 使用 capture 阶段绑定，确保快速拖拽时即使用户松开在分割线外也能收到 mouseup
        document.addEventListener('mousemove', handleMouseMove, true);
        document.addEventListener('mouseup', handleMouseUp, true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    }, [handleMouseMove, handleMouseUp]);

    return (
        <div
            ref={containerRef}
            className="flex flex-row h-full w-full min-h-0"
        >
            {/* 左侧面板 */}
            <div
                className="relative min-h-0 flex flex-col"
                style={{
                    width: `${leftRatio}%`,
                    ...(leftMinSizePx != null ? { minWidth: leftMinSizePx } : {})
                }}
            >
                {leftPanel}
            </div>

            {/* 分割线：加宽可拖拽区域（16px）便于悬停与拖拽，视觉中线保持 1px；hover 时高亮 */}
            <div
                className="relative w-4 flex-shrink-0 flex items-center justify-center cursor-col-resize group bg-stone-50 dark:bg-zinc-900 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors min-w-4"
                onMouseDown={handleMouseDown}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={Math.round(leftRatio)}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-px bg-stone-200 dark:bg-zinc-700 group-hover:bg-stone-300 dark:group-hover:bg-zinc-600 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical size={14} className="text-stone-500 dark:text-zinc-400" />
                </div>
            </div>

            {/* 右侧面板 */}
            <div
                className="relative min-h-0 flex-1 flex flex-col"
                style={rightMinSizePx != null ? { minWidth: rightMinSizePx } : undefined}
            >
                {rightPanel}
            </div>
        </div>
    );
}
