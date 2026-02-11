import { useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface ProjectCreateDialogProps {
    onClose: () => void;
    onConfirm: (name: string) => void;
}

export function ProjectCreateDialog({ onClose, onConfirm }: ProjectCreateDialogProps) {
    const { t } = useI18n();
    const [name, setName] = useState('');

    const handleConfirm = () => {
        if (name.trim()) {
            onConfirm(name.trim());
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200 border border-stone-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-stone-800 dark:text-zinc-100 text-lg">{t('newProject')}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 text-stone-400 hover:text-stone-600 dark:hover:text-zinc-300 rounded-lg transition-colors"
                        aria-label={t('cancel') || '关闭'}
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
                            placeholder={t('newProjectNamePlaceholder')}
                            className="w-full px-3 py-2 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 text-stone-900 dark:text-zinc-100"
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                            aria-label={t('projectName')}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-stone-700 dark:text-zinc-300 mb-2">
                            {t('projectPath')}
                        </label>
                        <div className="px-3 py-2.5 bg-stone-50 dark:bg-zinc-800/80 border border-stone-200 dark:border-zinc-700 rounded-lg text-stone-600 dark:text-zinc-400 text-sm font-mono break-all">
                            {t('projectCreatePathFixed')}
                        </div>
                        <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-500">
                            {t('projectCreatePathHint')}
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 mt-6">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 text-sm font-medium text-stone-600 dark:text-zinc-300 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                    >
                        {t('cancel') || '取消'}
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={!name.trim()}
                        className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                    >
                        {t('createProject')}
                    </button>
                </div>
            </div>
        </div>
    );
}
