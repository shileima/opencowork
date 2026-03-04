import { useEffect, useState } from 'react';
import { TerminalPanel } from '../components/project/TerminalPanel';
import { useI18n } from '../i18n/I18nContext';

export function TerminalWindow() {
    const { t } = useI18n();
    const [cwd, setCwd] = useState<string>('');

    useEffect(() => {
        const hash = window.location.hash;
        const match = hash.match(/terminal-window\?cwd=([^&]+)&windowId=([^&]+)/);
        if (match) {
            setCwd(decodeURIComponent(match[1]));
        } else {
            // Fallback to home directory or current working directory from IPC
            // Try to get current project path, fallback to home directory
            window.ipcRenderer.invoke('project:get-current').then((project: any) => {
                if (project?.path) {
                    setCwd(project.path);
                } else {
                    window.ipcRenderer.invoke('app:get-user-data-path').then((userDataPath: unknown) => {
                        setCwd((userDataPath as string) || process.env.HOME || '/');
                    }).catch(() => {
                        setCwd(process.env.HOME || '/');
                    });
                }
            }).catch(() => {
                setCwd(process.env.HOME || '/');
            });
        }
    }, []);

    if (!cwd) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-stone-50 dark:bg-zinc-900">
                <div className="text-stone-400 dark:text-zinc-500">{t('loading')}...</div>
            </div>
        );
    }

    return (
        <div className="h-screen w-full bg-stone-50 dark:bg-zinc-900">
            <TerminalPanel projectPath={cwd} />
        </div>
    );
}
