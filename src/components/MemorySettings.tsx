import { useState, useEffect } from 'react';
import { FileText, AlertTriangle, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/useI18n';
import { logger } from '../services/logger';

interface MemoryFile {
    path: string;
    name: string;
    size: number;
    type: 'global' | 'project';
    modified: Date;
}

interface MemorySettingsProps {
    onClose: () => void;
}

export function MemorySettings({ onClose: _onClose }: MemorySettingsProps) {
    const { t } = useI18n();
    const [memories, setMemories] = useState<MemoryFile[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadMemories();
    }, []);

    const loadMemories = async () => {
        try {
            setLoading(true);
            const result = await window.ipcRenderer.invoke('memory:list-files') as MemoryFile[];
            setMemories(result);
        } catch (error) {
            logger.error('Failed to load memories:', error);
        } finally {
            setLoading(false);
        }
    };

    const deleteFile = async (path: string) => {
        if (!confirm(t('confirmDeleteMemory'))) return;

        try {
            await window.ipcRenderer.invoke('memory:delete', path);
            loadMemories();
        } catch (error) {
            logger.error('Failed to delete file:', error);
            alert(t('deleteFailed'));
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatDate = (date: Date): string => {
        const locale = t('memory') === '记忆' ? 'zh-CN' : 'en-US';
        return new Date(date).toLocaleString(locale, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const globalCount = memories.filter(m => m.type === 'global').length;
    const projectCount = memories.filter(m => m.type === 'project').length;
    const totalSize = memories.reduce((sum, m) => sum + m.size, 0);

    return (
        <div className="space-y-5">
            {/* 说明文本 */}
            <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg p-3 text-xs">
                <p>
                    <strong>{t('autoMemoryManagement')}</strong>：{t('autoMemoryDesc')}
                </p>
            </div>

            {/* 统计卡片 - 3列布局 */}
            <div>
                <p className="text-xs font-medium text-stone-500 dark:text-zinc-400 mb-2">{t('memoryOverview')}</p>
                <div className="grid grid-cols-3 gap-2">
                    {/* 文件数量 */}
                    <div className="p-3 bg-stone-50 dark:bg-zinc-800/50 rounded-lg border border-stone-200 dark:border-zinc-700">
                        <div className="flex items-center gap-1.5 mb-2">
                            <FileText size={14} className="text-stone-400" />
                            <span className="text-xs font-medium text-stone-600 dark:text-zinc-300">{t('memoryFiles')}</span>
                        </div>
                        <div className="text-2xl font-bold text-stone-800 dark:text-zinc-100">
                            {memories.length}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-1">
                            {globalCount} {t('global')} / {projectCount} {t('project')}
                        </div>
                    </div>

                    {/* 总大小 */}
                    <div className="p-3 bg-stone-50 dark:bg-zinc-800/50 rounded-lg border border-stone-200 dark:border-zinc-700">
                        <div className="flex items-center gap-1.5 mb-2">
                            <AlertTriangle size={14} className="text-stone-400" />
                            <span className="text-xs font-medium text-stone-600 dark:text-zinc-300">{t('totalSize')}</span>
                        </div>
                        <div className="text-2xl font-bold text-stone-800 dark:text-zinc-100">
                            {formatSize(totalSize)}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-1">
                            {memories.length} {t('files')}
                        </div>
                    </div>

                    {/* 自动模式 */}
                    <div className="p-3 bg-green-50/50 dark:bg-green-900/10 rounded-lg border border-green-200 dark:border-green-700/50">
                        <div className="flex items-center gap-1.5 mb-2">
                            <FileText size={14} className="text-green-500" />
                            <span className="text-xs font-medium text-green-700 dark:text-green-400">{t('managementMode')}</span>
                        </div>
                        <div className="text-lg font-bold text-stone-800 dark:text-zinc-100">
                            {t('automatic')}
                        </div>
                        <div className="text-[10px] text-stone-400 mt-1">
                            {t('aiManaged')}
                        </div>
                    </div>
                </div>
            </div>

            {/* 记忆文件列表 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-stone-500 dark:text-zinc-400">{t('memoryFileList')}</p>
                    <button
                        onClick={loadMemories}
                        className="text-xs text-orange-600 hover:text-orange-700"
                    >
                        {t('refresh')}
                    </button>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-stone-400 text-xs">{t('loading')}</div>
                ) : memories.length === 0 ? (
                    <div className="p-8 text-center text-stone-400 text-xs border border-dashed border-stone-300 dark:border-zinc-700 rounded-lg">
                        {t('noMemoryFiles')}
                    </div>
                ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {memories.map((file) => (
                            <div
                                key={file.path}
                                className="flex items-center justify-between p-3 bg-stone-50 dark:bg-zinc-800/50 rounded-lg border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <FileText size={16} className={`flex-shrink-0 ${
                                        file.type === 'global' ? 'text-blue-500' : 'text-green-500'
                                    }`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-stone-700 dark:text-zinc-300 truncate">
                                                {file.name}
                                            </span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                file.type === 'global'
                                                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                                    : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                                            }`}>
                                                {file.type === 'global' ? t('global') : t('project')}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-stone-500">
                                            <span>{formatSize(file.size)}</span>
                                            <span>·</span>
                                            <span>{formatDate(file.modified)}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => deleteFile(file.path)}
                                    className="ml-2 p-1.5 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                    title={t('remove')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 提示信息 */}
            {memories.length > 0 && (
                <div className="flex items-start gap-2 p-3 bg-stone-50 dark:bg-zinc-800/50 rounded-lg border border-stone-200 dark:border-zinc-700">
                    <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-stone-600 dark:text-zinc-400 leading-relaxed">
                        <strong>{t('memoryWarning')}</strong>
                    </p>
                </div>
            )}
        </div>
    );
}
