import { useRef, useEffect } from 'react';
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
    /** 卸载前同步当前内容到父组件（切换 tab 时避免内容丢失） */
    onBeforeUnmount?: (currentContent: string) => void;
}

export function MonacoEditor({ filePath, content, onChange, onSave, onBeforeUnmount }: MonacoEditorProps) {
    const { t } = useI18n();
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const onBeforeUnmountRef = useRef(onBeforeUnmount);
    onBeforeUnmountRef.current = onBeforeUnmount;

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
            'tsx': 'typescript', // Monaco 的 typescript 模式已支持 .tsx，使用 typescript 才能激活 worker 与高亮
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

    const handleBeforeMount = (monaco: typeof import('monaco-editor')) => {
        try {
            const m = monaco as {
                languages?: {
                    typescript?: {
                        typescriptDefaults?: {
                            setDiagnosticsOptions: (o: { noSemanticValidation?: boolean }) => void;
                            setCompilerOptions: (o: Record<string, unknown>) => void;
                            addExtraLib: (content: string, filePath?: string) => void;
                        };
                        javascriptDefaults?: { setDiagnosticsOptions: (o: { noSemanticValidation?: boolean }) => void; setCompilerOptions: (o: Record<string, unknown>) => void };
                        JsxEmit?: { React: number };
                    };
                };
            };
            const ts = m.languages?.typescript;
            const JsxReact = ts?.JsxEmit?.React ?? 2;
            if (ts?.typescriptDefaults) {
                ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
                ts.typescriptDefaults.setCompilerOptions({
                    jsx: JsxReact,
                    allowNonTsExtensions: true,
                    moduleResolution: 2, // Node
                });
                ts.typescriptDefaults.addExtraLib(
                    'declare module "antd/locale/zh_CN" { const zhCN: { locale: string }; export default zhCN; }',
                    'ts:antd-locale.d.ts'
                );
            }
            if (ts?.javascriptDefaults) {
                ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
                ts.javascriptDefaults.setCompilerOptions({
                    jsx: JsxReact,
                    allowNonTsExtensions: true,
                    allowJs: true,
                });
            }
        } catch {
            // Monaco 未加载 TypeScript 扩展时忽略
        }
    };

    const handleEditorDidMount = (editorInst: editor.IStandaloneCodeEditor, monacoInst: typeof import('monaco-editor')) => {
        editorRef.current = editorInst;

        // Ctrl/Cmd+S：直接保存。Monaco 内置 format 会破坏 JSX（如 < h1、className= "..."），改用项目工具栏的「格式化」按钮（oxfmt）更可靠。
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

    // 切换 tab 卸载前，将编辑器当前内容同步到父组件，避免内容互相覆盖
    useEffect(() => {
        return () => {
            const currentContent = editorRef.current?.getValue();
            if (currentContent !== undefined) {
                onBeforeUnmountRef.current?.(currentContent);
            }
        };
    }, []);

    // 必须传 path，TypeScript 根据 URI 扩展名判断是否解析 JSX；无 path 时模型无 .tsx 后缀，会误报 '>' expected
    const modelPath = filePath
        ? `file://${filePath.startsWith('/') ? '' : '/'}${filePath.replace(/\\/g, '/')}`
        : undefined;

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                path={modelPath}
                language={getLanguage(filePath)}
                value={content}
                beforeMount={handleBeforeMount}
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
