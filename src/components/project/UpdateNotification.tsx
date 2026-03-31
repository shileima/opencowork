import { useState, useEffect, useRef } from 'react';
import { Download, X, Loader2, CheckCircle } from 'lucide-react';

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
    /** 主进程在发现新版本后会立即执行更新，界面直接进入进度态 */
    const [isUpdating, setIsUpdating] = useState(true);
    const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
    const [updateDone, setUpdateDone] = useState(false);
    const [countdown, setCountdown] = useState(3);
    const [restartTimeout, setRestartTimeout] = useState(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const removeProgress = window.ipcRenderer?.on('resource:update-progress', (_event: unknown, ...args: unknown[]) => {
            const progress = args[0] as UpdateProgress;
            setUpdateProgress(progress);
            if (progress?.stage === 'completed') {
                setUpdateDone(true);
                setCountdown(3);
                setIsUpdating(false);
            }
        });

        const removeFailed = window.ipcRenderer?.on('resource:update-failed', (_event: unknown, ...args: unknown[]) => {
            const payload = args[0] as { message?: string };
            setIsUpdating(false);
            setUpdateProgress(null);
            alert(`资源自动更新失败: ${payload?.message ?? '未知错误'}\n\n可稍后在「关于」中重试或检查网络。`);
            onCloseRef.current();
        });

        return () => {
            removeProgress?.();
            removeFailed?.();
        };
    }, []);

    // 更新成功后倒计时（主进程会在 1.5s 后自动重启，此处仅展示倒计时提示）
    useEffect(() => {
        if (!updateDone) return;

        if (countdown <= 0) return;

        const timer = setTimeout(() => {
            setCountdown(prev => prev - 1);
        }, 500);

        return () => clearTimeout(timer);
    }, [updateDone, countdown]);

    // 如果主进程 10 秒内未重启，显示手动重启按钮
    useEffect(() => {
        if (!updateDone) return;

        const timer = setTimeout(() => {
            setRestartTimeout(true);
        }, 10000);

        return () => clearTimeout(timer);
    }, [updateDone]);

    const handleManualRestart = async () => {
        try {
            await window.ipcRenderer?.invoke('resource:restart-app');
        } catch {
            alert('请手动关闭并重新打开应用以完成更新。');
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
            default: return '正在准备自动更新...';
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
                            {updateDone
                                ? <CheckCircle size={20} className="text-green-600 dark:text-green-400" />
                                : <Download size={20} className="text-orange-600 dark:text-orange-400" />
                            }
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-orange-700 dark:text-orange-300 mb-0.5">
                                {updateDone ? '✅ 更新完成' : '正在自动更新资源'}
                            </h3>
                            <p className="text-sm text-orange-600 dark:text-orange-400">
                                {updateDone
                                    ? `应用即将重启以应用新版本...`
                                    : `v${currentVersion} → v${latestVersion} ${formatSize(updateSize)}（无需操作）`
                                }
                            </p>
                        </div>
                        {!isUpdating && !updateDone && (
                            <button
                                onClick={onClose}
                                className="p-1.5 text-orange-500 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded-lg transition-colors"
                                aria-label="关闭"
                            >
                                <X size={18} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="p-5 bg-white dark:bg-zinc-900">
                    {/* Progress Bar */}
                    {isUpdating && !updateDone && updateProgress && (
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

                    {/* Restart countdown */}
                    {updateDone && !restartTimeout && (
                        <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400 py-1">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm font-medium">
                                正在重启应用，请稍候...
                            </span>
                        </div>
                    )}

                    {/* Manual restart fallback */}
                    {updateDone && restartTimeout && (
                        <div className="flex flex-col items-center gap-3 py-1">
                            <p className="text-sm text-orange-600 dark:text-orange-400 text-center">
                                更新已完成，但应用未能自动重启。
                            </p>
                            <button
                                type="button"
                                onClick={handleManualRestart}
                                className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 rounded-lg transition-all shadow-sm hover:shadow-md flex items-center gap-2"
                            >
                                <Loader2 size={14} />
                                立即重启应用
                            </button>
                        </div>
                    )}

                    {/* Updating State（无进度包时占位） */}
                    {isUpdating && !updateDone && !updateProgress && (
                        <div className="flex items-center justify-center gap-2 text-orange-600 dark:text-orange-400 py-1">
                            <Loader2 size={14} className="animate-spin" />
                            <span className="text-sm font-medium">正在连接更新服务，请稍候...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
