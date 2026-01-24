import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { Check, X } from 'lucide-react';

interface ToastData {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

interface ToastContextValue {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

function ToastItem({ data, onClose }: { data: ToastData; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 2000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className={`
                flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg
                ${data.type === 'success' ? 'bg-green-500 text-white' : ''}
                ${data.type === 'error' ? 'bg-red-500 text-white' : ''}
                ${data.type === 'info' ? 'bg-stone-800 text-white dark:bg-zinc-700' : ''}
            `}>
                {data.type === 'success' && <Check size={16} />}
                {data.type === 'error' && <X size={16} />}
                {data.type === 'info' && <div className="w-2 h-2 rounded-full bg-orange-500" />}
                <span className="text-sm font-medium">{data.message}</span>
            </div>
        </div>
    );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastData[]>([]);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        const id = Math.random().toString(36).slice(2);
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const closeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {toasts.map(toast => (
                <ToastItem key={toast.id} data={toast} onClose={() => closeToast(toast.id)} />
            ))}
        </ToastContext.Provider>
    );
}
