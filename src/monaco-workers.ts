/**
 * 配置 Monaco Editor 的 Web Workers，确保 TS/JS/TSX 语法高亮与语言特性正常工作。
 * 必须在首次加载 Monaco 之前执行。
 * @see https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md
 */
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';

const w = self as Window & { MonacoEnvironment?: { getWorker: (workerId: string, label: string) => Worker } };
w.MonacoEnvironment = {
  getWorker(_, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};
