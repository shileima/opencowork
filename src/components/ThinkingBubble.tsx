import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';

interface ThinkingBubbleProps {
    thinkingText: string;
}

export function ThinkingBubble({ thinkingText }: ThinkingBubbleProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!thinkingText) {
        return null;
    }

    return (
        <div className="bg-stone-50 dark:bg-zinc-800/50 rounded-xl border border-stone-200 dark:border-zinc-700 overflow-hidden my-3">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-stone-100/30 dark:hover:bg-zinc-700/30 transition-colors text-left"
            >
                <Brain size={14} className="text-stone-500 dark:text-zinc-400 flex-shrink-0" />
                <span className="text-xs font-medium text-stone-700 dark:text-zinc-300 flex-1">
                    AI 思考过程
                </span>
                <span className="text-[10px] text-stone-500 dark:text-zinc-400">
                    {thinkingText.length} 字符
                </span>
                {isExpanded ? (
                    <ChevronUp size={12} className="text-stone-500 dark:text-zinc-400 flex-shrink-0" />
                ) : (
                    <ChevronDown size={12} className="text-stone-500 dark:text-zinc-400 flex-shrink-0" />
                )}
            </button>
            {isExpanded && (
                <div className="px-3 pb-3">
                    <div className="bg-white dark:bg-black/30 rounded-lg p-2.5 text-xs text-stone-600 dark:text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed max-h-60 overflow-y-auto">
                        {thinkingText}
                    </div>
                </div>
            )}
        </div>
    );
}
