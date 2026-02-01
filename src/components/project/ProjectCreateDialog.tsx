import { useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface ProjectCreateDialogProps {
    onClose: () => void;
    onConfirm: (name: string, path: string) => void;
}

export function ProjectCreateDialog({ onClose, onConfirm }: ProjectCreateDialogProps) {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [path, setPath] = useState('/Users/shilei/Documents/');

    const handleSelectPath = async () => {
        const selectedPath = await window.ipcRenderer.invoke('dialog:select-folder') as string | null;
        if (selectedPath) {
            setPath(selectedPath);
            // 如果没有设置名称，使用文件夹名称
            if (!name) {
                const folderName = selectedPath.split(/[\\/]/).pop() || '';
                setName(folderName);
            }
        }
    };

    const handleConfirm = () => {
        if (name.trim() && path.trim()) {
            onConfirm(name.trim(), path.trim());
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200 border border-stone-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-stone-800 dark:text-zinc-100 text-lg">{t('newProject')}</h3>
                    <button
                        onClick={onClose}
                        className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                            {t('projectName')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t('projectName')}
                            className="w-full px-3 py-2 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 text-stone-900 dark:text-zinc-100"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                            {t('projectPath')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={path}
                                onChange={(e) => setPath(e.target.value)}
                                placeholder={t('projectPath')}
                                className="flex-1 px-3 py-2 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 text-stone-900 dark:text-zinc-100"
                            />
                            <button
                                onClick={handleSelectPath}
                                className="px-4 py-2 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-colors flex items-center gap-2 text-stone-700 dark:text-zinc-300"
                            >
                                <FolderOpen size={16} />
                                {t('selectProjectPath')}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                    >
                        {t('cancel') || '取消'}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!name.trim() || !path.trim()}
                        className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                    >
                        {t('createProject')}
                    </button>
                </div>
            </div>
        </div>
    );
}
