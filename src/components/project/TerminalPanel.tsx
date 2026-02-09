import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import {
    Plus,
    ChevronDown,
    PanelBottomClose,
    Trash2,
    Maximize2,
    X,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { SplitPane } from './TerminalSplitPane';

const DEFAULT_SHELL_LABEL = 'zsh';

// 全局 Map，用于保存每个终端的 xterm 实例，避免切换子 tab 时重复初始化
const terminalXtermInstances = new Map<string, { xterm: XTerm; fitAddon: FitAddon }>();

interface TerminalInstance {
    id: string;
    name: string;
    cwd: string;
    status?: 'running' | 'exited';
}

interface TerminalPanelProps {
    projectPath: string;
    onClosePanel?: () => void;
}

type SplitDirection = 'horizontal' | 'vertical';

interface SplitLayout {
    direction: SplitDirection;
    sizes: number[];
    children: Array<{ instanceId: string } | SplitLayout>;
}

/** 收集 split 布局中所有终端实例 id，用于判断当前激活的终端是否在拆分视图中 */
function getInstanceIdsInLayout(layout: SplitLayout): Set<string> {
    const ids = new Set<string>();
    const visit = (l: SplitLayout) => {
        for (const child of l.children) {
            if ('instanceId' in child) ids.add(child.instanceId);
            else visit(child);
        }
    };
    visit(layout);
    return ids;
}

/** 从拆分布局中移除指定实例；若移除后只剩一个实例则返回 null，使剩余终端通栏展示 */
function removeInstanceFromLayout(
    layout: SplitLayout,
    removeId: string
): { layout: SplitLayout | null; remainingId: string | null } {
    const newChildren: Array<{ instanceId: string } | SplitLayout> = [];
    for (const child of layout.children) {
        if ('instanceId' in child) {
            if (child.instanceId === removeId) continue;
            newChildren.push(child);
        } else {
            const result = removeInstanceFromLayout(child, removeId);
            if (result.layout !== null) {
                newChildren.push(result.layout);
            } else if (result.remainingId !== null) {
                newChildren.push({ instanceId: result.remainingId });
            }
        }
    }
    if (newChildren.length === 0) return { layout: null, remainingId: null };
    if (newChildren.length === 1) {
        const only = newChildren[0];
        if ('instanceId' in only) return { layout: null, remainingId: only.instanceId };
        return { layout: only, remainingId: null };
    }
    return {
        layout: {
            ...layout,
            children: newChildren,
            sizes: layout.sizes.slice(0, newChildren.length),
        },
        remainingId: null,
    };
}

export function TerminalPanel({ projectPath, onClosePanel }: TerminalPanelProps) {
    const { t } = useI18n();
    const [instances, setInstances] = useState<TerminalInstance[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [splitLayout, setSplitLayout] = useState<SplitLayout | null>(null);
    const instanceIdsRef = useRef<string[]>([]);
    const nextIndexRef = useRef(1);

    instanceIdsRef.current = instances.map((i) => i.id);

    // Create first instance on mount
    useEffect(() => {
        if (!projectPath.trim() || instances.length > 0) return;
        const id = `terminal-${Date.now()}-0`;
        const name = `${t('terminal')} 1`;
        nextIndexRef.current = 2;
        setInstances([{ id, name, cwd: projectPath.trim(), status: 'running' }]);
        setActiveId(id);
    }, [projectPath, t, instances.length]);

    const addInstance = useCallback(() => {
        const id = `terminal-${Date.now()}-${nextIndexRef.current}`;
        const name = `${t('terminal')} ${nextIndexRef.current}`;
        nextIndexRef.current += 1;
        // 如果有活动终端，使用活动终端的工作目录；否则使用项目路径
        const activeInstance = instances.find(inst => inst.id === activeId);
        const newCwd = activeInstance?.cwd || projectPath.trim();
        setInstances((prev) => [...prev, { id, name, cwd: newCwd, status: 'running' }]);
        setActiveId(id);
        return id;
    }, [projectPath, t, instances, activeId]);

    const splitTerminal = useCallback(() => {
        if (!activeId) return;
        const newInstanceId = addInstance();
        const direction: SplitDirection = 'horizontal';
        if (!splitLayout) {
            setSplitLayout({
                direction,
                sizes: [50, 50],
                children: [
                    { instanceId: activeId },
                    { instanceId: newInstanceId },
                ],
            });
        } else {
            const findAndSplit = (layout: SplitLayout, targetId: string): SplitLayout | null => {
                for (let i = 0; i < layout.children.length; i++) {
                    const child = layout.children[i];
                    if ('instanceId' in child && child.instanceId === targetId) {
                        const newLayout: SplitLayout = {
                            direction,
                            sizes: [50, 50],
                            children: [
                                { instanceId: targetId },
                                { instanceId: newInstanceId },
                            ],
                        };
                        const newSizes = [...layout.sizes];
                        const oldSize = newSizes[i];
                        newSizes[i] = oldSize / 2;
                        newSizes.splice(i + 1, 0, oldSize / 2);
                        return {
                            ...layout,
                            sizes: newSizes,
                            children: [
                                ...layout.children.slice(0, i),
                                newLayout,
                                ...layout.children.slice(i + 1),
                            ],
                        };
                    } else if (!('instanceId' in child)) {
                        const result = findAndSplit(child, targetId);
                        if (result) {
                            return {
                                ...layout,
                                children: layout.children.map((c, idx) => (idx === i ? result : c)),
                            };
                        }
                    }
                }
                return null;
            };
            const newLayout = findAndSplit(splitLayout, activeId);
            if (newLayout) setSplitLayout(newLayout);
        }
    }, [activeId, splitLayout, addInstance]);

    const closeInstance = useCallback((id: string) => {
        setInstances((prev) => {
            if (prev.length <= 1) return prev;
            const next = prev.filter((i) => i.id !== id);
            setActiveId((cur) => (cur === id ? (next[0]?.id ?? null) : cur));
            window.ipcRenderer.invoke('terminal:destroy', id);
            const xtermInstance = terminalXtermInstances.get(id);
            if (xtermInstance) {
                try {
                    xtermInstance.xterm.dispose();
                } catch (e) {
                    console.error('[TerminalPanel] Error disposing xterm:', e);
                }
                terminalXtermInstances.delete(id);
            }
            return next;
        });
        // 从拆分布局中移除该实例：若只剩一个则取消拆分，剩余终端通栏展示
        setSplitLayout((prev) => {
            if (!prev) return null;
            const { layout: newLayout } = removeInstanceFromLayout(prev, id);
            return newLayout;
        });
    }, []);

    const setActive = useCallback((id: string) => {
        setActiveId(id);
    }, []);

    // 组件卸载时销毁所有终端实例，避免切换项目后残留进程
    useEffect(() => {
        return () => {
            const ids = instanceIdsRef.current;
            ids.forEach((id) => {
                window.ipcRenderer.invoke('terminal:destroy', id).catch((e: unknown) =>
                    console.error('[TerminalPanel] Unmount destroy terminal:', id, e)
                );
                const xtermInstance = terminalXtermInstances.get(id);
                if (xtermInstance) {
                    try {
                        xtermInstance.xterm.dispose();
                    } catch (e) {
                        console.error('[TerminalPanel] Error disposing xterm on unmount:', e);
                    }
                    terminalXtermInstances.delete(id);
                }
            });
        };
    }, []);

    const handleOpenInNewWindow = useCallback(async () => {
        try {
            const result = await window.ipcRenderer.invoke('terminal:open-window', {
                cwd: projectPath.trim(),
            }) as { success?: boolean; error?: string; windowId?: string };
            if (!result.success && result.error) {
                console.error('Failed to open terminal window:', result.error);
            }
        } catch (error) {
            console.error('Error opening terminal window:', error);
        }
    }, [projectPath]);

    // On unmount, destroy all terminal sessions
    useEffect(() => {
        return () => {
            instanceIdsRef.current.forEach((id) => {
                window.ipcRenderer.invoke('terminal:destroy', id);
            });
        };
    }, []);

    return (
        <div className="flex flex-col h-full w-full min-h-0 bg-stone-50 dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex items-center gap-1 py-1 border-b border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
                <button
                    type="button"
                    onClick={addInstance}
                    className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded transition-colors"
                    title={t('terminalNew')}
                    aria-label={t('terminalNew')}
                >
                    <Plus size={16} />
                </button>
                <div className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-stone-500 dark:text-zinc-400" aria-label="Shell">
                    <span>{DEFAULT_SHELL_LABEL}</span>
                    <ChevronDown size={12} />
                </div>
                <button
                    type="button"
                    onClick={splitTerminal}
                    disabled={!activeId}
                    className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('terminalSplit')}
                    aria-label={t('terminalSplit')}
                >
                    <PanelBottomClose size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => activeId && closeInstance(activeId)}
                    disabled={!activeId}
                    className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={t('terminalKill')}
                    aria-label={t('terminalKill')}
                >
                    <Trash2 size={14} />
                </button>
                <button
                    type="button"
                    onClick={handleOpenInNewWindow}
                    className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded transition-colors"
                    title={t('terminalOpenInNewWindow')}
                    aria-label={t('terminalOpenInNewWindow')}
                >
                    <Maximize2 size={12} />
                </button>
                <div className="flex-1 min-w-0" />
                {onClosePanel && (
                    <button
                        type="button"
                        onClick={onClosePanel}
                        className="p-1.5 text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200 rounded transition-colors"
                        title={t('closeTab')}
                        aria-label={t('closeTab')}
                    >
                        <Maximize2 size={16} />
                    </button>
                )}
            </div>

            {/* Instance tabs */}
            <div className="flex items-center gap-0.5 border-b border-stone-200 dark:border-zinc-800 bg-stone-100/50 dark:bg-zinc-800/30 px-1 py-0.5 shrink-0 overflow-x-auto">
                {instances.map((inst) => (
                    <div
                        key={inst.id}
                        role="tab"
                        tabIndex={0}
                        aria-selected={activeId === inst.id}
                        aria-label={inst.name}
                        className={`group flex items-center gap-1.5 px-1 py-1.5 rounded-t text-xs font-light cursor-pointer transition-colors ${
                            activeId === inst.id
                                ? 'bg-white dark:bg-zinc-900 text-stone-900 dark:text-zinc-100 border border-b-0 border-stone-200 dark:border-zinc-800 -mb-px'
                                : 'text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
                        }`}
                        onClick={() => setActive(inst.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setActive(inst.id);
                            }
                        }}
                    >
                        {/* <TerminalIcon size={14} className="shrink-0" /> */}
                        <span className="max-w-[120px] truncate">{inst.name}</span>
                        {inst.status === 'exited' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-label="Exited" />
                        )}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                closeInstance(inst.id);
                            }}
                            className={`p-0.5 rounded hover:bg-stone-200 dark:hover:bg-zinc-700 transition-opacity shrink-0 ${
                                activeId === inst.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            title={t('closeTab')}
                            aria-label={`${t('closeTab')} ${inst.name}`}
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Content: render split layout or single view */}
            <div className="flex-1 min-h-0 flex flex-col">
                {instances.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-stone-400 dark:text-zinc-500">
                        <div className="text-center">
                            <p className="text-sm mb-2">{t('terminal')}</p>
                            <button
                                type="button"
                                onClick={addInstance}
                                className="text-sm text-orange-600 dark:text-orange-400 hover:underline"
                            >
                                {t('terminalNew')}
                            </button>
                        </div>
                    </div>
                ) : splitLayout && activeId && getInstanceIdsInLayout(splitLayout).has(activeId) ? (
                    <RenderSplitLayout
                        layout={splitLayout}
                        instances={instances}
                        activeId={activeId}
                        onStatusChange={(id, status) => {
                            setInstances((prev) =>
                                prev.map((i) => (i.id === id ? { ...i, status } : i))
                            );
                        }}
                        onSizesChange={(sizes) => {
                            setSplitLayout((prev) => prev ? { ...prev, sizes } : null);
                        }}
                    />
                ) : (
                    instances.map((inst) => (
                        <div
                            key={inst.id}
                            className="h-full w-full min-h-0"
                            style={{
                                display: activeId === inst.id ? 'block' : 'none',
                                position: 'relative',
                                width: '100%',
                                height: '100%',
                            }}
                        >
                            <TerminalView
                                terminalId={inst.id}
                                cwd={inst.cwd}
                                isActive={activeId === inst.id}
                                onStatusChange={(status) => {
                                    setInstances((prev) =>
                                        prev.map((i) => (i.id === inst.id ? { ...i, status } : i))
                                    );
                                }}
                            />
                        </div>
                    ))
                )}
            </div>

            {/* Optional hint */}
            <div className="px-2 py-1 text-xs text-stone-400 dark:text-zinc-500 border-t border-stone-200 dark:border-zinc-800 shrink-0">
                {t('cmdKGenerateCommand')}
            </div>
        </div>
    );
}

interface RenderSplitLayoutProps {
    layout: SplitLayout;
    instances: TerminalInstance[];
    activeId: string | null;
    onStatusChange: (id: string, status: 'running' | 'exited') => void;
    onSizesChange: (sizes: number[]) => void;
}

function RenderSplitLayout({ layout, instances, activeId, onStatusChange, onSizesChange }: RenderSplitLayoutProps) {
    const renderChild = (child: { instanceId: string } | SplitLayout, index: number): React.ReactNode => {
        if ('instanceId' in child) {
            const inst = instances.find((i) => i.id === child.instanceId);
            if (!inst) return null;
            return (
                <TerminalView
                    key={child.instanceId}
                    terminalId={inst.id}
                    cwd={inst.cwd}
                    isActive={activeId === inst.id}
                    onStatusChange={(status) => onStatusChange(inst.id, status)}
                />
            );
        } else {
            return (
                <RenderSplitLayout
                    key={index}
                    layout={child}
                    instances={instances}
                    activeId={activeId}
                    onStatusChange={onStatusChange}
                    onSizesChange={(sizes) => {
                        // Update nested layout sizes - simplified implementation
                        // In a full implementation, we'd need to properly update nested layouts
                        onSizesChange(sizes);
                    }}
                />
            );
        }
    };

    return (
        <SplitPane
            direction={layout.direction}
            sizes={layout.sizes}
            onSizesChange={onSizesChange}
        >
            {layout.children.map((child, index) => renderChild(child, index))}
        </SplitPane>
    );
}

interface TerminalViewProps {
    terminalId: string;
    cwd: string;
    isActive?: boolean;
    onStatusChange?: (status: 'running' | 'exited') => void;
}


function TerminalView({ terminalId, cwd, isActive = true, onStatusChange }: TerminalViewProps) {
    const { t } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const hasShownExitErrorRef = useRef(false);
    const hasRestartedRef = useRef(false);
    const focusAfterNextOutputRef = useRef(false);
    const pendingDestroyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initialOutputChunksRef = useRef(0);
    // 命令历史
    const commandHistoryRef = useRef<string[]>([]);
    const historyIndexRef = useRef(-1);
    const currentInputRef = useRef('');
    // 提示符（从 shell 输出中提取，默认为 '$ '）
    const promptRef = useRef('$ ');
    // 终端模式：'pty' 或 'pipe'（PTY 模式下 shell 会自动回显，不需要手动回显）
    const terminalModeRef = useRef<'pty' | 'pipe' | null>(null);

    // When becoming active: reset input state + fit + focus + refresh. Delay so layout and xterm are ready.
    useEffect(() => {
        if (!isActive) {
            // 当 tab 变为非活动时，重置输入状态，避免切换回来时状态混乱
            currentInputRef.current = '';
            historyIndexRef.current = -1;
            return;
        }
        
        // 重置输入状态，确保切换回来时是干净的状态
        currentInputRef.current = '';
        historyIndexRef.current = -1;
        
        const focusOnce = () => {
            const xterm = xtermRef.current;
            const fitAddon = fitAddonRef.current;
            if (xterm && fitAddon && containerRef.current) {
                try {
                    const rect = containerRef.current.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        // 先强制触发一次 reflow，确保缓冲区内容正确
                        // 这很重要，因为当 tab 隐藏时 cols 可能为 0，导致内容被截断
                        const currentCols = xterm.cols;
                        const currentRows = xterm.rows;
                        
                        // 如果当前 cols 为 0 或很小，先设置一个临时值来触发 reflow
                        if (currentCols === 0 || currentCols < 10) {
                            // 临时设置一个合理的列数来触发 reflow
                            const tempCols = Math.floor(rect.width / 8); // 估算列数
                            if (tempCols > 0) {
                                xterm.resize(tempCols, currentRows || 24);
                            }
                        }
                        
                        // 执行 fit 确保尺寸正确
                        fitAddon.fit();
                        const cols = xterm.cols;
                        const rows = xterm.rows;
                        
                        // 如果 fit 后的尺寸与之前不同，需要重新触发 reflow
                        if (cols !== currentCols || rows !== currentRows) {
                            // 强制触发 resize 来重新 reflow 缓冲区
                            xterm.resize(cols, rows);
                        }
                        
                        // 通知后端当前尺寸，保持 PTY 与前端一致
                        if (cols > 0 && rows > 0) {
                            window.ipcRenderer.invoke('terminal:resize', terminalId, cols, rows);
                        }
                        
                        // 确保滚动到底部，显示最新的内容
                        xterm.scrollToBottom();
                        
                        // 强制刷新整个显示区域，确保所有内容都正确渲染
                        xterm.refresh(0, xterm.rows - 1);
                        
                        // 额外刷新最后几行和光标所在行
                        const lastRow = xterm.rows - 1;
                        xterm.refresh(Math.max(0, lastRow - 5), lastRow);
                        const buffer = xterm.buffer.active;
                        const cursorY = buffer.cursorY;
                        if (cursorY >= 0 && cursorY < xterm.rows) {
                            xterm.refresh(Math.max(0, cursorY - 2), Math.min(xterm.rows - 1, cursorY + 2));
                        }
                        
                        xterm.focus();
                        
                        // 下一帧再刷新一次，确保 reflow 后的内容完全渲染
                        requestAnimationFrame(() => {
                            if (xtermRef.current && xtermRef.current === xterm) {
                                xtermRef.current.scrollToBottom();
                                xtermRef.current.refresh(0, xtermRef.current.rows - 1);
                            }
                        });
                        setTimeout(() => {
                            if (xtermRef.current && xtermRef.current === xterm) {
                                xtermRef.current.scrollToBottom();
                                xtermRef.current.refresh(0, xtermRef.current.rows - 1);
                            }
                        }, 50);
                        setTimeout(() => {
                            if (xtermRef.current && xtermRef.current === xterm) {
                                xtermRef.current.scrollToBottom();
                                xtermRef.current.refresh(0, xtermRef.current.rows - 1);
                            }
                        }, 150);
                    } else {
                        // 如果容器尺寸还是0，延迟重试
                        setTimeout(focusOnce, 50);
                    }
                } catch (e) {
                    console.error('[TerminalView] Focus fit error:', e);
                }
            }
        };
        
        // 使用多个延迟确保容器已经可见并且有正确的尺寸
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                focusOnce();
                // Try again after another frame to ensure layout is stable
                requestAnimationFrame(() => {
                    focusOnce();
                });
            });
        });
        const tid = setTimeout(focusOnce, 100);
        const tid2 = setTimeout(focusOnce, 250); // 额外的延迟确保容器完全可见
        return () => {
            cancelAnimationFrame(id);
            clearTimeout(tid);
            clearTimeout(tid2);
        };
    }, [isActive, terminalId]);

    useEffect(() => {
        if (!containerRef.current) return;

        if (pendingDestroyRef.current) {
            clearTimeout(pendingDestroyRef.current);
            pendingDestroyRef.current = null;
        }

        // 检查是否已存在 xterm 实例，如果存在则复用，避免切换子 tab 时重复初始化
        const existingInstance = terminalXtermInstances.get(terminalId);
        let xterm: XTerm;
        let fitAddon: FitAddon;
        let isReusing = false;

        if (existingInstance) {
            // 复用现有的 xterm 实例
            isReusing = true;
            xterm = existingInstance.xterm;
            fitAddon = existingInstance.fitAddon;
            // 将 xterm 实例移动到新的容器（如果容器已改变）
            if (xterm.element?.parentNode !== containerRef.current) {
                xterm.open(containerRef.current);
            }
            xtermRef.current = xterm;
            fitAddonRef.current = fitAddon;
            // 注意：不要在这里立即执行 fit，因为容器可能还是隐藏的（display: none）
            // fit 会在 isActive 变为 true 时通过 useEffect 执行
            // 复用时，onData 已经注册过了，不需要重复注册
            // 直接跳到监听器注册部分
        } else {
            // 创建新的 xterm 实例
            xterm = new XTerm({
                cursorBlink: true,
                fontSize: 12, // 字体小一号
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                letterSpacing: 0,
                lineHeight: 1.2,
                theme: {
                    background: '#1e1e1e',
                    foreground: '#d4d4d4',
                    cursor: '#aeafad',
                    cursorAccent: '#000000',
                    black: '#000000',
                    red: '#cd3131',
                    green: '#0dbc79',
                    yellow: '#e5e510',
                    blue: '#2472c8',
                    magenta: '#bc3fbc',
                    cyan: '#11a8cd',
                    white: '#e5e5e5',
                    brightBlack: '#666666',
                    brightRed: '#f14c4c',
                    brightGreen: '#23d18b',
                    brightYellow: '#f5f543',
                    brightBlue: '#3b8eea',
                    brightMagenta: '#d670d6',
                    brightCyan: '#29b8db',
                    brightWhite: '#e5e5e5',
                },
                allowProposedApi: true,
                cols: 80,
                rows: 24,
                convertEol: true,
                disableStdin: false,
                cursorStyle: 'block',
                // 注意：xterm.js 在非 TTY 模式下不会自动本地回显输入
                // 我们需要在 onData 回调中手动回显输入字符
            });

            fitAddon = new FitAddon();
            xterm.loadAddon(fitAddon);
            
            if (!containerRef.current) return;
            
            xterm.open(containerRef.current);
            
            // 保存 xterm 实例到全局 Map，以便后续复用
            terminalXtermInstances.set(terminalId, { xterm, fitAddon });
            
            // Force initial fit after container is ready
            // Use multiple strategies to ensure fit happens when container has dimensions
            const performFit = () => {
                try {
                    if (containerRef.current && fitAddon) {
                        const rect = containerRef.current.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            // Force a reflow before fitting
                            containerRef.current.offsetHeight;
                            fitAddon.fit();
                            // Verify the fit worked
                            const { cols, rows } = xterm;
                            if (cols === 0 || rows === 0) {
                                console.warn('[TerminalView] Fit resulted in zero dimensions, retrying...');
                                setTimeout(performFit, 100);
                            }
                        } else {
                            // Container not ready, retry
                            setTimeout(performFit, 50);
                        }
                    }
                } catch (e) {
                    console.error('[TerminalView] Fit error:', e);
                }
            };
            
            // Wait for container to be ready
            const initFit = () => {
                if (containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        performFit();
                    } else {
                        setTimeout(initFit, 10);
                    }
                }
            };
            
            // Start initialization
            setTimeout(initFit, 0);
        }

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        const scheduleFit = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        if (containerRef.current && fitAddon) {
                            const rect = containerRef.current.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                fitAddon.fit();
                                const { cols, rows } = xterm;
                                if (cols > 0 && rows > 0) {
                                    window.ipcRenderer.invoke('terminal:resize', terminalId, cols, rows);
                                }
                            }
                        }
                        if (isActive && xterm) {
                            xterm.focus();
                        }
                    } catch (e) {
                        console.error('[TerminalView] Schedule fit error:', e);
                    }
                });
            });
        };
        scheduleFit();

        const resizeObserver = new ResizeObserver(() => {
            try {
                // 当标签隐藏时容器尺寸为 0，此时不要 fit，否则会把 xterm 设为 0 列，
                // 导致缓冲区错误 reflow，切换回来时只显示截断的提示（如 "~/Library/A"）
                if (fitAddon && containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        fitAddon.fit();
                        const { cols, rows } = xterm;
                        if (cols > 0 && rows > 0) {
                            window.ipcRenderer.invoke('terminal:resize', terminalId, cols, rows);
                        }
                    }
                }
            } catch (e) {
                console.error('[TerminalView] ResizeObserver fit error:', e);
            }
        });
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        // 只在首次创建时调用 terminal:create，复用时不再重复创建
        if (!isReusing) {
            window.ipcRenderer.invoke('terminal:create', { id: terminalId, cwd }).then((result: unknown) => {
                const response = result as { success?: boolean; error?: string; mode?: 'pty' | 'pipe' };
                if (response.success) {
                    // 保存终端模式
                    terminalModeRef.current = response.mode || 'pipe'; // 默认为 pipe（向后兼容）
                    console.log(`[TerminalPanel] Terminal created in ${terminalModeRef.current} mode`);
                    scheduleFit();
                    setTimeout(() => {
                        xterm.focus();
                    }, 150);
                } else {
                    const errorMsg = response.error || 'Failed to create terminal';
                    xterm.write(`\r\n[错误: ${errorMsg}]\r\n`);
                    console.error('[TerminalPanel] Failed to create terminal:', errorMsg);
                }
            }).catch((error: unknown) => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                xterm.write(`\r\n[错误: ${errorMsg}]\r\n`);
                console.error('[TerminalPanel] Error creating terminal:', error);
            });
        } else {
            // 复用时，只需确保 fit 和 focus
            scheduleFit();
            if (isActive) {
                setTimeout(() => {
                    xterm.focus();
                }, 100);
            }
        }

        const NOISE_PATTERNS = [
            'bash: no job control in this shell',
            'The default interactive shell is now zsh',
            'To update your account to use zsh',
            'please run `chsh -s /bin/zsh`',
            'For more details, please visit https://support.apple.com',
        ];
        const filterPipeNoise = (raw: string): string => {
            if (initialOutputChunksRef.current > 8) return raw;
            initialOutputChunksRef.current += 1;
            let out = raw;
            
            // 先过滤掉包含 eval 和 base64 的命令（可能跨多行）
            // 匹配 eval "$(echo '...' | base64 -d ...)" 2>/dev/null; 这样的模式
            // 使用更宽松的正则表达式来匹配可能跨行的命令
            out = out.replace(/eval\s+"\$\(echo\s+'[^']*'\s+\|\s+base64\s+-d[^"]*\)"\s+2>\/dev\/null;?\s*/g, '');
            // 匹配可能跨行的 eval 命令（处理换行符）
            out = out.replace(/eval\s+"\$\(echo\s+'[^']*'\s+\|\s+base64\s+-d[^"]*\)"\s+2>\/dev\/null;?\s*\r?\n?/g, '');
            
            // Only filter complete lines that match noise patterns, preserve formatting
            const lines = out.split('\n');
            const filteredLines = lines.filter(line => {
                const trimmed = line.trim();
                // 过滤掉包含 eval 和 base64 的行
                if (trimmed.includes('eval "$(echo') && trimmed.includes('base64 -d')) {
                    return false;
                }
                // 过滤掉只包含 2>/dev/null; 的行（可能是 eval 命令的续行）
                if (trimmed === '2>/dev/null;' || trimmed === '2>/dev/null') {
                    return false;
                }
                // 过滤掉其他噪音模式
                return !NOISE_PATTERNS.some(pattern => 
                    trimmed.toLowerCase().includes(pattern.toLowerCase())
                );
            });
            out = filteredLines.join('\n');
            // Don't trim the entire output, just collapse excessive blank lines
            out = out.replace(/\n{3,}/g, '\n\n');
            return out;
        };

        const removeOutput = window.ipcRenderer.on('terminal:output', (_event: unknown, ...args: unknown[]) => {
            const [id, data] = args as [string, string];
            if (id === terminalId) {
                // Only filter noise in initial chunks, then pass through all output
                const toWrite = initialOutputChunksRef.current <= 8 ? filterPipeNoise(data) : data;
                if (toWrite) {
                    // 尝试从输出中提取提示符（例如 "$ "）
                    // 提示符通常出现在行首，格式如 "$ " 或 "user@host $ "
                    const promptMatch = toWrite.match(/^([^\n]*\$ )/m);
                    if (promptMatch && promptMatch[1]) {
                        promptRef.current = promptMatch[1];
                    }
                    
                    // 在 pipe 模式下，shell 的输出会覆盖 xterm 的本地回显
                    // 但 shell 本身应该回显输入（如果以交互模式运行）
                    // 如果 shell 不回显，我们需要确保输入可见
                    xterm.write(toWrite);
                }
                if (focusAfterNextOutputRef.current) {
                    focusAfterNextOutputRef.current = false;
                    setTimeout(() => {
                        xterm.focus();
                    }, 50);
                }
            }
        });

        const removeExit = window.ipcRenderer.on('terminal:exit', (_event: unknown, ...args: unknown[]) => {
            const [id] = args as [string];
            if (id !== terminalId) return;
            if (hasRestartedRef.current || hasShownExitErrorRef.current) {
                hasShownExitErrorRef.current = true;
                onStatusChange?.('exited');
                xterm.write(`\r\n[${t('terminalProcessExited')}\r\n${t('terminalExitedHint')}]\r\n`);
                return;
            }
            hasRestartedRef.current = true;
            xterm.write(`\r\n[${t('terminalRestarting')}]\r\n`);
            window.ipcRenderer.invoke('terminal:create', { id: terminalId, cwd }).then((result: unknown) => {
                const response = result as { success?: boolean; error?: string; mode?: 'pty' | 'pipe' };
                if (response.success) {
                    // 更新终端模式
                    terminalModeRef.current = response.mode || 'pipe';
                    focusAfterNextOutputRef.current = true;
                    const focusAfterRestart = () => {
                        xtermRef.current?.focus();
                    };
                    setTimeout(focusAfterRestart, 100);
                    setTimeout(focusAfterRestart, 400);
                } else {
                    hasShownExitErrorRef.current = true;
                    onStatusChange?.('exited');
                    xterm.write(`\r\n[${t('terminalProcessExited')}\r\n${t('terminalExitedHint')}]\r\n`);
                }
            }).catch((err: unknown) => {
                console.error('[TerminalPanel] Error restarting terminal:', err);
                hasShownExitErrorRef.current = true;
                onStatusChange?.('exited');
                xterm.write(`\r\n[${t('terminalProcessExited')}\r\n${t('terminalExitedHint')}]\r\n`);
            });
        });

        // 在 pipe 模式下，shell 不会回显输入（因为 stdin 不是 TTY）
        // xterm.js 默认不会自动本地回显，我们需要手动回显输入
        // 这样用户才能看到他们输入的字符
        
        // 处理命令历史（上下键）
        const handleHistoryNavigation = (direction: 'up' | 'down') => {
            const history = commandHistoryRef.current;
            if (history.length === 0) return;
            
            // 获取当前光标位置（简化处理：假设在行尾）
            const cols = xterm.cols;
            const prompt = promptRef.current;
            
            if (direction === 'up') {
                if (historyIndexRef.current === -1) {
                    // 保存当前输入（在按下上键时）
                    // currentInputRef.current 已经在输入时更新
                }
                if (historyIndexRef.current < history.length - 1) {
                    historyIndexRef.current += 1;
                    const command = history[history.length - 1 - historyIndexRef.current];
                    // 清除当前行：回到行首，用空格填充，再回到行首
                    const currentLength = (prompt + currentInputRef.current).length || (prompt + command).length;
                    xterm.write('\r' + ' '.repeat(Math.max(currentLength, cols)) + '\r');
                    // 写入提示符和命令
                    xterm.write(prompt + command);
                    currentInputRef.current = command;
                }
            } else {
                if (historyIndexRef.current > 0) {
                    historyIndexRef.current -= 1;
                    const command = history[history.length - 1 - historyIndexRef.current];
                    const currentLength = (prompt + currentInputRef.current).length || (prompt + command).length;
                    xterm.write('\r' + ' '.repeat(Math.max(currentLength, cols)) + '\r');
                    xterm.write(prompt + command);
                    currentInputRef.current = command;
                } else if (historyIndexRef.current === 0) {
                    historyIndexRef.current = -1;
                    const savedInput = currentInputRef.current || '';
                    const currentLength = (prompt + savedInput).length;
                    xterm.write('\r' + ' '.repeat(Math.max(currentLength, cols)) + '\r');
                    xterm.write(prompt + savedInput);
                    currentInputRef.current = savedInput;
                }
            }
        };

        // 只在首次创建时注册 onData，复用时已有注册，避免重复注册
        if (!isReusing) {
            xterm.onData(async (data: string) => {
                // 处理特殊按键
                const charCode = data.charCodeAt(0);
                
                // Ctrl+C (0x03)
                if (charCode === 3) {
                    // 先回显 Ctrl+C
                    xterm.write('^C\r\n');
                    // 发送 Ctrl+C 字符到 shell（让 shell 处理中断）
                    try {
                        await window.ipcRenderer.invoke('terminal:write', terminalId, '\x03');
                    } catch (error) {
                        console.error('[TerminalPanel] Failed to write Ctrl+C:', error);
                    }
                    // 同时也发送 SIGINT 信号（双重保险）
                    try {
                        await window.ipcRenderer.invoke('terminal:signal', terminalId, 'SIGINT');
                    } catch (error) {
                        console.error('[TerminalPanel] Failed to send SIGINT:', error);
                    }
                    return;
                }
                
                // ESC 序列（方向键等）
                if (data.startsWith('\x1b')) {
                    // 上箭头: \x1b[A
                    if (data === '\x1b[A') {
                        handleHistoryNavigation('up');
                        return;
                    }
                    // 下箭头: \x1b[B
                    if (data === '\x1b[B') {
                        handleHistoryNavigation('down');
                        return;
                    }
                    // 其他 ESC 序列直接发送到 shell
                }
                
                // 根据终端模式决定是否手动回显
                // PTY 模式：shell 会自动回显，不需要手动回显
                // Pipe 模式：需要手动回显（因为 shell 不会回显）
                const isPtyMode = terminalModeRef.current === 'pty';
                const isPrintable = charCode >= 32 && charCode !== 127; // 32-126 是可打印字符，127 是 DEL
                const isEnter = data === '\r' || data === '\n' || data === '\r\n';
                
                if (isPrintable || data === '\t') {
                    // 只在 Pipe 模式下手动回显（PTY 模式下 shell 会自动回显）
                    if (!isPtyMode) {
                        xterm.write(data);
                    }
                    // 更新当前输入（两种模式都需要）
                    if (historyIndexRef.current === -1) {
                        currentInputRef.current += data;
                    }
                } else if (isEnter) {
                    // 回车/换行：在 Pipe 模式下需要手动写入换行
                    // PTY 模式下 shell 会自动处理
                    if (!isPtyMode) {
                        xterm.write('\r\n');
                    }
                    // 保存命令到历史（不包含提示符）
                    const command = currentInputRef.current.trim();
                    if (command && (commandHistoryRef.current.length === 0 || commandHistoryRef.current[commandHistoryRef.current.length - 1] !== command)) {
                        commandHistoryRef.current.push(command);
                        if (commandHistoryRef.current.length > 100) {
                            commandHistoryRef.current.shift();
                        }
                    }
                    historyIndexRef.current = -1;
                    currentInputRef.current = '';
                } else if (data === '\x7f' || data === '\b') {
                    // 退格键：只在 Pipe 模式下手动处理（PTY 模式下 shell 会自动处理）
                    if (!isPtyMode) {
                        xterm.write('\b \b');
                    }
                    if (historyIndexRef.current === -1 && currentInputRef.current.length > 0) {
                        currentInputRef.current = currentInputRef.current.slice(0, -1);
                    }
                } else if (data.length > 1 || (charCode >= 1 && charCode <= 31 && charCode !== 9 && charCode !== 10 && charCode !== 13 && charCode !== 3)) {
                    // ESC 序列或其他控制字符，直接发送到 shell
                }
                
                try {
                    // 将输入发送到 shell
                    const result = await window.ipcRenderer.invoke('terminal:write', terminalId, data) as { success?: boolean; error?: string };
                    if (!result.success && result.error && (result.error.includes('exited') || result.error.includes('not found'))) {
                        if (!hasRestartedRef.current) {
                            hasRestartedRef.current = true;
                            xterm.write(`\r\n[${t('terminalRestarting')}]\r\n`);
                            const createResult = await window.ipcRenderer.invoke('terminal:create', { id: terminalId, cwd }) as { success?: boolean; error?: string; mode?: 'pty' | 'pipe' };
                            if (createResult.success) {
                                // 更新终端模式
                                terminalModeRef.current = createResult.mode || 'pipe';
                                await window.ipcRenderer.invoke('terminal:write', terminalId, data);
                                return;
                            }
                        }
                        if (!hasShownExitErrorRef.current) {
                            hasShownExitErrorRef.current = true;
                            onStatusChange?.('exited');
                            xterm.write(`\r\n[${t('terminalProcessExited')}\r\n${t('terminalExitedHint')}]\r\n`);
                        }
                        return;
                    }
                    if (!result.success && result.error) {
                        console.error('[TerminalPanel] Failed to write:', result.error);
                        if (!hasShownExitErrorRef.current) {
                            hasShownExitErrorRef.current = true;
                            xterm.write(`\r\n[错误: ${result.error}]\r\n`);
                        }
                    }
                } catch (error) {
                    console.error('[TerminalPanel] Error writing to terminal:', error);
                }
            });
        }

        const handleResize = () => {
            try {
                if (fitAddon && containerRef.current) {
                    const rect = containerRef.current.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        fitAddon.fit();
                        const { cols, rows } = xterm;
                        if (cols > 0 && rows > 0) {
                            window.ipcRenderer.invoke('terminal:resize', terminalId, cols, rows);
                        }
                    }
                }
            } catch (e) {
                console.error('[TerminalView] Resize error:', e);
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            removeOutput();
            removeExit();
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            // 注意：不要在这里销毁 xterm 实例，因为切换子 tab 时组件会重新挂载，需要复用 xterm
            // 只有在真正关闭终端时才销毁（在 closeInstance 中处理）
            // 不清除 xtermRef 和 fitAddonRef，以便复用
        };
    }, [terminalId, cwd, isActive, t]);

    const handleContainerClick = () => {
        xtermRef.current?.focus();
    };

    return (
        <div
            ref={containerRef}
            role="application"
            aria-label={t('terminal')}
            className="terminal-container h-full w-full cursor-text min-h-0 outline-none"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
            }}
            onClick={handleContainerClick}
            onKeyDown={(e) => {
                e.stopPropagation();
                xtermRef.current?.focus();
            }}
        />
    );
}
