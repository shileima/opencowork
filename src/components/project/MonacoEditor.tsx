import { useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useI18n } from '../../i18n/I18nContext';
import { Loader2 } from 'lucide-react';

interface MonacoEditorProps {
    filePath: string | null;
    content: string;
    onChange: (content: string) => void;
    /** 保存时传入当前编辑器内容，避免使用 React state 可能滞后的值 */
    onSave?: (currentContent: string) => void;
}

export function MonacoEditor({ filePath, content, onChange, onSave }: MonacoEditorProps) {
    const { t } = useI18n();
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    const loadingPlaceholder = (
        <div className="h-full w-full flex flex-col items-center justify-center bg-[#1e1e1e] text-zinc-400 gap-3" role="status" aria-label={t('loading')}>
            <Loader2 size={28} className="animate-spin shrink-0" aria-hidden />
            <span className="text-sm">{t('loading')}</span>
        </div>
    );

    const getLanguage = (path: string | null): string => {
        if (!path) return 'plaintext';
        const ext = path.split('.').pop()?.toLowerCase();
        const languageMap: Record<string, string> = {
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'json': 'json',
            'md': 'markdown',
            'css': 'css',
            'html': 'html',
            'py': 'python',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'go': 'go',
            'rs': 'rust',
            'php': 'php',
            'rb': 'ruby',
            'sh': 'shell',
            'yaml': 'yaml',
            'yml': 'yaml',
            'xml': 'xml',
            'sql': 'sql',
        };
        return languageMap[ext || ''] || 'plaintext';
    };

    const handleEditorDidMount = (editorInst: editor.IStandaloneCodeEditor, monacoInst: typeof import('monaco-editor')) => {
        editorRef.current = editorInst;
        
        // 添加保存快捷键 (Ctrl/Cmd+S)，从编辑器实例取当前内容，避免 state 未同步导致保存旧内容
        if (monacoInst?.KeyMod && monacoInst?.KeyCode) {
            editorInst.addCommand(
                monacoInst.KeyMod.CtrlCmd | monacoInst.KeyCode.KeyS,
                () => {
                    const currentContent = editorRef.current?.getValue() ?? content;
                    onSave?.(currentContent);
                }
            );
        }
    };

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                language={getLanguage(filePath)}
                value={content}
                onChange={(value) => onChange(value || '')}
                onMount={handleEditorDidMount}
                theme="vs-dark"
                loading={loadingPlaceholder}
                options={{
                    fontSize: 12,
                    minimap: { enabled: true },
                    wordWrap: 'on',
                    automaticLayout: true,
                    tabSize: 2,
                    insertSpaces: true,
                    formatOnPaste: true,
                    formatOnType: true,
                    scrollBeyondLastLine: false,
                }}
            />
        </div>
    );
}
