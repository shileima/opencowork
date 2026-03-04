import { useState } from 'react';
import { AlertTriangle, Check, X, FolderOpen } from 'lucide-react';

interface ConfirmationRequest {
    id: string;
    tool: string;
    description: string;
    args: Record<string, unknown>;
}

interface ConfirmDialogProps {
    request: ConfirmationRequest | null;
    onConfirm: (id: string, remember: boolean, tool: string, path?: string) => void;
    onDeny: (id: string) => void;
}

import { useI18n } from '../i18n/I18nContext';

export function ConfirmDialog({ request, onConfirm, onDeny }: ConfirmDialogProps) {
    const { t } = useI18n();
    const [remember, setRemember] = useState(false);

    if (!request) return null;

    const path = (request.args?.path || request.args?.cwd) as string | undefined;
    const isFolderAuth = request.tool === 'authorize_folder';

    if (isFolderAuth) {
        return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    {/* Header */}
                    <div className="p-5 border-b border-border bg-blue-500/10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/20 rounded-full">
                                <FolderOpen className="text-blue-500" size={24} />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">授权目录访问</h3>
                                <p className="text-sm text-muted-foreground">AI 需要读取该目录中的文件</p>
                            </div>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="p-5 space-y-3">
                        <p className="text-sm text-muted-foreground">允许 AI 访问以下目录？授权后 AI 可读取该目录及其子目录中的文件。</p>
                        <div className="bg-secondary/50 px-3 py-2 rounded-lg">
                            <p className="font-mono text-sm break-all">{path}</p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 p-5 border-t border-border bg-muted/30">
                        <button
                            onClick={() => onDeny(request.id)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 text-destructive rounded-xl hover:bg-destructive/20 transition-colors font-medium"
                        >
                            <X size={18} /> 拒绝
                        </button>
                        <button
                            onClick={() => onConfirm(request.id, false, request.tool, path)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
                        >
                            <Check size={18} /> 授权访问
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-5 border-b border-border bg-amber-500/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-full">
                            <AlertTriangle className="text-amber-500" size={24} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-lg">{t('actionConfirmation')}</h3>
                            <p className="text-sm text-muted-foreground">{t('confirmActionDesc')}</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('tool')}</p>
                        <p className="font-mono text-sm bg-secondary/50 px-3 py-2 rounded-lg">{request.tool}</p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('description')}</p>
                        <p className="text-foreground">{request.description}</p>
                    </div>
                    {request.args && Object.keys(request.args).length > 0 && (
                        <div>
                            <p className="text-sm text-muted-foreground mb-1">{t('arguments')}</p>
                            <pre className="bg-secondary/50 p-3 rounded-lg text-xs font-mono overflow-x-auto max-h-32">
                                {JSON.stringify(request.args, null, 2)}
                            </pre>
                        </div>
                    )}
                    {/* Remember checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-secondary/30 transition-colors">
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                            className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-sm text-muted-foreground">{t('rememberChoice')}</span>
                    </label>
                </div>

                {/* Actions */}
                <div className="flex gap-3 p-5 border-t border-border bg-muted/30">
                    <button
                        onClick={() => {
                            setRemember(false);
                            onDeny(request.id);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 text-destructive rounded-xl hover:bg-destructive/20 transition-colors font-medium"
                    >
                        <X size={18} /> {t('deny')}
                    </button>
                    <button
                        onClick={() => {
                            onConfirm(request.id, remember, request.tool, path);
                            setRemember(false);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
                    >
                        <Check size={18} /> {t('allow')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Re-export useConfirmations for convenience
export { useConfirmations } from './useConfirmations';

