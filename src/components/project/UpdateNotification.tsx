import { useState, useEffect } from 'react';
import { Download, X, Loader2 } from 'lucide-react';

interface UpdateNotificationProps {
    currentVersion: string;
    latestVersion: string;
    updateSize?: number;
    onClose: () => void;
}

interface UpdateProgress {
    stage?: 'checking' | 'downloading' | 'extracting' | 'applying' | 'completed';
    percentage?: number;
    downloaded?: number;
    total?: number;
    current?: string;
}

export function UpdateNotification({
    currentVersion,
    latestVersion,
    updateSize,
    onClose
}: UpdateNotificationProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);

    useEffect(() => {
        // 监听更新进度
        const removeListener = window.ipcRenderer?.on('resource:update-progress', (_event: unknown, ...args: unknown[]) => {
            const progress = args[0] as UpdateProgress;
            setUpdateProgress(progress);
        });

        return () => {
            if (removeListener) {
                removeListener();
            }
        };
    }, []);

    const handleUpdate = async () => {
        setIsUpdating(true);
        setUpdateProgress(null);
        
        try {
            const result = await window.ipcRenderer?.invoke('resource:perform-update') as { success: boolean; error?: string } | undefined;
            
            if (result && result.success) {
                // 更新完成，提示重启
                if (confirm('资源更新完成！是否立即重启应用以应用更改？')) {
                    await window.ipcRenderer?.invoke('resource:restart-app');
                } else {
                    onClose();
                }
            } else {
                const errorMsg = result?.error || '未知错误';
                alert(`资源更新失败: ${errorMsg}\n\n请检查网络连接或稍后重试。`);
                setIsUpdating(false);
                setUpdateProgress(null);
            }
        } catch (error: unknown) {
            console.error('Resource update failed', error);
            const errorMsg = error instanceof Error ? error.message : '未知错误';
            alert(`资源更新失败: ${errorMsg}\n\n请检查开发者控制台获取详细信息。`);
            setIsUpdating(false);
            setUpdateProgress(null);
        }
    };

    const formatSize = (bytes?: number): string => {
        if (!bytes) return '';
        return `(${(bytes / 1024 / 1024).toFixed(2)} MB)`;
    };

    const getStageText = (stage?: string): string => {
        switch (stage) {
            case 'checking': return '检查更新中...';
            case 'downloading': return '下载资源包中...';
            case 'extracting': return '解压文件中...';
            case 'applying': return '应用更新中...';
            case 'completed': return '更新完成！';
            default: return '准备更新...';
        }
    };

    const getProgressPercentage = (): number => {
        if (updateProgress?.percentage !== undefined) {
            return updateProgress.percentage;
        }
        if (updateProgress?.downloaded && updateProgress?.total) {
            return (updateProgress.downloaded / updateProgress.total) * 100;
        }
        return 0;
    };

    return (
        <div className="fixed top-12 right-4 z-[9999] w-[420px] animate-in slide-in-from-top-2 fade-in duration-300">
            <div className="bg-white dark:bg-zinc-900 border-2 border-orange-400 dark:border-orange-600 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="relative bg-gradient-to-r from-orange-400/20 to-amber-400/20 dark:from-orange-500/20 dark:to-amber-500/20 px-6 py-3.5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center shrink-0">
                            <Download size={20} className="text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-orange-700 dark:text-orange-300 mb-0.5">
                                🎉 发现新资源版本!
                            </h3>
                            <p className="text-sm text-orange-600 dark:text-orange-400">
                                当前: v{currentVersion} → 最新: v{latestVersion} {formatSize(updateSize)}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            disabled={isUpdating}
                            className="p-1.5 text-orange-500 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="关闭"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-5 bg-white dark:bg-zinc-900">
                    {/* Progress Bar */}
                    {isUpdating && updateProgress && (
                        <div className="mb-4 space-y-2">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-orange-700 dark:text-orange-300 font-medium">
                                    {getStageText(updateProgress.stage)}
                                </span>
                                <span className="text-orange-600 dark:text-orange-400 font-mono font-semibold tabular-nums inline-block text-right min-w-[3.5rem]">
                                    {Math.round(getProgressPercentage())}%
                                </span>
                            </div>
                            <div className="w-full h-2 bg-orange-200 dark:bg-orange-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300 ease-out"
                                    style={{ width: `${getProgressPercentage()}%` }}
                                />
                            </div>
                            {updateProgress.current && (
                                <p className="text-xs text-orange-600 dark:text-orange-400 truncate" title={updateProgress.current}>
                                    {updateProgress.current}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Buttons */}
                    {!isUpdating && (
                        <div className="flex gap-2.5 justify-end">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 text-sm font-medium text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded-lg transition-colors"
                            >
                                稍后提醒
                            </button>
                            <button
                                onClick={handleUpdate}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 rounded-lg transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-1.5"
                            >
                                <Download size={12} />
                                立即更新
                            </button>
                        </div>
                    )}

                    {/* Updating State */}
                    {isUpdating && (
                        <div className="flex items-center justify-center gap-2 text-orange-600 dark:text-orange-400 py-1">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm font-medium">正在更新，请稍候...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
