import { useRef, useEffect } from 'react';
import { ChatInput } from '../ChatInput';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { CopyButton } from '../CopyButton';
import Anthropic from '@anthropic-ai/sdk';
import { useI18n } from '../../i18n/I18nContext';

interface ChatPanelProps {
    history: Anthropic.MessageParam[];
    streamingText: string;
    onSendMessage: (message: string | { content: string, images: string[] }) => void;
    onAbort: () => void;
    isProcessing: boolean;
    workingDir: string | null;
    config: any;
    setConfig: (config: any) => void;
    /** Project 模式：锁定项目，底部聊天固定为当前项目且不允许切换 */
    lockedProjectName?: string | null;
    /** 是否正在加载历史会话 */
    isLoadingHistory?: boolean;
}

export function ChatPanel({
    history,
    streamingText,
    onSendMessage,
    onAbort,
    isProcessing,
    workingDir,
    config,
    setConfig,
    lockedProjectName,
    isLoadingHistory = false
}: ChatPanelProps) {
    const { t } = useI18n();
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, streamingText]);

    const relevantHistory = history.filter(m => (m.role as string) !== 'system');

    return (
        <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
            {/* Chat Messages - 聊天区域文字小 2 号 */}
            <div className="flex-1 overflow-y-auto px-4 py-6 text-xs" ref={scrollRef}>
                <div className="max-w-2xl mx-auto space-y-5">
                    {relevantHistory.length === 0 && !streamingText ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-20">
                            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-zinc-800 shadow-lg flex items-center justify-center rotate-3 border border-stone-100 dark:border-zinc-700 overflow-hidden">
                                <img src="./icon.png" alt="Logo" className="opacity-90 dark:opacity-80 w-full h-full object-cover" />
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-base font-semibold text-stone-800 dark:text-zinc-100">
                                    {isLoadingHistory ? t('loadingHistory') : t('startConversation')}
                                </h2>
                                <p className="text-stone-500 dark:text-zinc-400 text-[11px] max-w-xs">
                                    {isLoadingHistory ? (
                                        <span className="inline-flex items-center gap-1">
                                            <span className="inline-block w-1 h-1 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                            <span className="inline-block w-1 h-1 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                            <span className="inline-block w-1 h-1 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                        </span>
                                    ) : (
                                        t('startByDescribing')
                                    )}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {relevantHistory.map((msg, idx) => {
                                const isUser = msg.role === 'user';
                                const content = typeof msg.content === 'string' 
                                    ? msg.content 
                                    : Array.isArray(msg.content)
                                    ? (msg.content.find((b: any) => b.type === 'text') as any)?.text || ''
                                    : '';

                                // 如果内容为空，不渲染消息
                                if (!content || content.trim().length === 0) {
                                    return null;
                                }

                                return (
                                    <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                        <div className={` ${isUser ? '' : 'w-full'}`}>
                                            {isUser ? (
                                                <div className="relative group inline-block">
                                                    <div className="user-bubble">
                                                        {content}
                                                    </div>
                                                    {content && content.trim().length > 0 && (
                                                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <CopyButton content={content} size="sm" />
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-stone-700 dark:text-zinc-300 text-xs leading-5 max-w-none">
                                                    <div className="relative group">
                                                        <MarkdownRenderer content={content} isDark={true} className="prose-sm !text-xs !leading-5" />
                                                        {content && content.trim().length > 0 && (
                                                            <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <CopyButton content={content} size="sm" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}

                            {streamingText && streamingText.trim().length > 0 && (
                                <div className="animate-in fade-in duration-200">
                                    <div className="text-stone-700 dark:text-zinc-300 text-xs leading-5 max-w-none">
                                        <div className="relative group">
                                            <MarkdownRenderer content={streamingText} isDark={true} className="prose-sm !text-xs !leading-5" />
                                            <span className="inline-block w-2 h-5 bg-orange-500 ml-0.5 animate-pulse" />
                                            {streamingText && streamingText.trim().length > 0 && (
                                                <div className="absolute right-0 -bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <CopyButton content={streamingText} size="sm" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {isProcessing && !streamingText && (
                                <div className="flex items-center gap-2 text-stone-400 text-[11px] animate-pulse">
                                    <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-bounce" />
                                    <span>{t('thinking')}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Chat Input */}
            <div className="border-t border-stone-200 dark:border-zinc-800 shrink-0">
                <ChatInput
                    onSendMessage={onSendMessage}
                    onAbort={onAbort}
                    isProcessing={isProcessing}
                    workingDir={workingDir}
                    onSelectFolder={() => {}}
                    mode="work"
                    config={config}
                    setConfig={setConfig}
                    lockedProjectName={lockedProjectName}
                />
            </div>
        </div>
    );
}
