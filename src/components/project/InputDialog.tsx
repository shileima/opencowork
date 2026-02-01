import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface InputDialogProps {
    title: string;
    label: string;
    defaultValue?: string;
    placeholder?: string;
    onClose: () => void;
    onConfirm: (value: string) => void;
}

export function InputDialog({
    title,
    label,
    defaultValue = '',
    placeholder,
    onClose,
    onConfirm
}: InputDialogProps) {
    const { t } = useI18n();
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // 自动聚焦输入框
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    const handleConfirm = () => {
        if (value.trim()) {
            onConfirm(value.trim());
            onClose();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConfirm();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95 duration-200 border border-stone-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-stone-800 dark:text-zinc-100 text-lg">{title}</h3>
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
                            {label}
                        </label>
                        <input
                            ref={inputRef}
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            className="w-full px-3 py-2 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 text-stone-900 dark:text-zinc-100"
                        />
                    </div>

                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-stone-600 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200 transition-colors"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!value.trim()}
                            className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('confirmAdd') || t('save') || '确认'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
