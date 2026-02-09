import { useState, useRef, useCallback, ReactNode } from 'react';
import { GripVertical, GripHorizontal } from 'lucide-react';

interface SplitPaneProps {
    direction: 'horizontal' | 'vertical';
    sizes: number[];
    children: ReactNode[];
    onSizesChange?: (sizes: number[]) => void;
    onClose?: (index: number) => void;
    minSize?: number;
}

export function SplitPane({ direction, sizes, children, onSizesChange, minSize = 10 }: SplitPaneProps) {
    const [localSizes, setLocalSizes] = useState(sizes);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ index: number; startPos: number; startSizes: number[] } | null>(null);

    const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
        e.preventDefault();
        const pos = direction === 'horizontal' ? e.clientY : e.clientX;
        dragStateRef.current = { index, startPos: pos, startSizes: [...localSizes] };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [direction, localSizes]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragStateRef.current || !containerRef.current) return;
        const { index, startPos, startSizes } = dragStateRef.current;
        const currentPos = direction === 'horizontal' ? e.clientY : e.clientX;
        const delta = currentPos - startPos;
        const containerSize = direction === 'horizontal'
            ? containerRef.current.clientHeight
            : containerRef.current.clientWidth;
        const deltaPercent = (delta / containerSize) * 100;

        const newSizes = [...startSizes];
        const leftSize = newSizes[index] + deltaPercent;
        const rightSize = newSizes[index + 1] - deltaPercent;

        if (leftSize >= minSize && rightSize >= minSize) {
            newSizes[index] = leftSize;
            newSizes[index + 1] = rightSize;
            setLocalSizes(newSizes);
            onSizesChange?.(newSizes);
        }
    }, [direction, minSize, onSizesChange]);

    const handleMouseUp = useCallback(() => {
        dragStateRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    const isVertical = direction === 'vertical';

    return (
        <div
            ref={containerRef}
            className={`flex ${isVertical ? 'flex-row' : 'flex-col'} h-full w-full min-h-0`}
        >
            {children.map((child, index) => (
                <div key={index} className="relative min-h-0 min-w-0" style={{
                    [isVertical ? 'width' : 'height']: `${localSizes[index]}%`,
                }}>
                    {child}
                    {index < children.length - 1 && (
                        <div
                            className={`absolute ${isVertical ? 'right-0 top-0 bottom-0 w-1 cursor-col-resize' : 'bottom-0 left-0 right-0 h-1 cursor-row-resize'} z-10 bg-stone-200 dark:bg-zinc-700 hover:bg-stone-300 dark:hover:bg-zinc-600 transition-colors group`}
                            style={{
                                [isVertical ? 'left' : 'top']: 'calc(100% - 2px)',
                            }}
                            onMouseDown={(e) => handleMouseDown(index, e)}
                        >
                            <div className={`absolute inset-0 flex items-center justify-center ${isVertical ? 'flex-col' : 'flex-row'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                                {isVertical ? (
                                    <GripVertical size={12} className="text-stone-500 dark:text-zinc-400" />
                                ) : (
                                    <GripHorizontal size={12} className="text-stone-500 dark:text-zinc-400" />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
