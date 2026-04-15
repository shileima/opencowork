import { useRef } from 'react';
import Editor, { type Monaco, loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useI18n } from '../../i18n/I18nContext';
import { Loader2 } from 'lucide-react';

/**
 * 使用国内 CDN 镜像加载 monaco-editor，避免从默认的 jsDelivr CDN 下载。
 * 这是编辑器打开慢的根因：Electron 内网环境下 jsDelivr CDN 访问极慢或不可达。
 *
 * 注意：不能用 `import * as monacoEditor from 'monaco-editor'` + `loader.config({ monaco })`
 * 的方式，因为这会让 Vite 把整个 monaco-editor ESM 源码（~50MB）纳入打包树，
 * 导致 CI 环境 OOM（JavaScript heap out of memory）。
 *
 * 使用 npmmirror CDN 替代 jsDelivr，国内访问速度极快（<100ms）。
 */
loader.config({
    paths: {
        vs: 'https://registry.npmmirror.com/monaco-editor/0.55.1/files/min/vs',
    },
});

/**
 * 内嵌编辑器没有磁盘 node_modules / tsconfig 工程上下文。
 * 通过通配符模块声明让所有 import 解析为 any，避免「找不到模块」误报；
 * 同时保留语义校验，能捕获未定义变量、语法错误等。
 */
function configureMonacoForIsolatedFiles(monaco: Monaco) {
    const ts = monaco.languages.typescript;

    const diag = {
        noSemanticValidation: false,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: true,
        diagnosticCodesToIgnore: [2307, 7016, 2686],
    };
    ts.typescriptDefaults.setDiagnosticsOptions(diag);
    ts.javascriptDefaults.setDiagnosticsOptions(diag);

    const sharedCompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        allowNonTsExtensions: true,
        esModuleInterop: true,
        skipLibCheck: true,
    };
    ts.typescriptDefaults.setCompilerOptions(sharedCompilerOptions);
    ts.javascriptDefaults.setCompilerOptions(sharedCompilerOptions);

    const globalShim = [
        'declare module "*";',
        'declare namespace JSX {',
        '  type Element = any;',
        '  interface IntrinsicElements { [tag: string]: any; }',
        '}',
    ].join('\n');
    ts.typescriptDefaults.addExtraLib(globalShim, 'file:///global-shim.d.ts');
    ts.javascriptDefaults.addExtraLib(globalShim, 'file:///global-shim.d.ts');
}

/** 释放 Monaco model（关闭 tab 时调用），停止 TS Worker 对该文件的持续分析 */
export function disposeMonacoModel(filePath: string) {
    loader.init().then((monaco) => {
        const uri = monaco.Uri.parse(filePath);
        const model = monaco.editor.getModel(uri);
        model?.dispose();
    }).catch(() => { /* best-effort */ });
}

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
    const onSaveRef = useRef(onSave);
    onSaveRef.current = onSave;

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
        
        if (monacoInst?.KeyMod && monacoInst?.KeyCode) {
            editorInst.addCommand(
                monacoInst.KeyMod.CtrlCmd | monacoInst.KeyCode.KeyS,
                () => {
                    const currentContent = editorRef.current?.getValue() ?? '';
                    onSaveRef.current?.(currentContent);
                }
            );
        }
    };

    return (
        <div className="h-full w-full">
            <Editor
                height="100%"
                path={filePath ?? undefined}
                language={getLanguage(filePath)}
                value={content}
                onChange={(value) => onChange(value || '')}
                beforeMount={configureMonacoForIsolatedFiles}
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
