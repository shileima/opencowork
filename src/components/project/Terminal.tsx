import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
    terminalId: string;
    cwd: string;
    onReady?: () => void;
}

export function Terminal({ terminalId, cwd, onReady }: TerminalProps) {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        // 创建终端实例
        const xterm = new XTerm({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
            },
        });

        const fitAddon = new FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(terminalRef.current);
        fitAddon.fit();

        xtermRef.current = xterm;
        fitAddonRef.current = fitAddon;

        // 创建终端会话
        window.ipcRenderer.invoke('terminal:create', { id: terminalId, cwd }).then(() => {
            onReady?.();
        });

        // 监听终端输出
        const removeOutputListener = window.ipcRenderer.on('terminal:output', (_event, ...args) => {
            const id = args[0] as string;
            const data = args[1] as string;
            if (id === terminalId) {
                xterm.write(data);
            }
        });

        const removeExitListener = window.ipcRenderer.on('terminal:exit', (_event, ...args) => {
            const id = args[0] as string;
            if (id === terminalId) {
                xterm.write('\r\n[进程已退出]\r\n');
            }
        });

        // 处理用户输入
        xterm.onData((data) => {
            window.ipcRenderer.invoke('terminal:write', terminalId, data);
        });

        // 处理窗口大小变化
        const handleResize = () => {
            fitAddon.fit();
            const { cols, rows } = xterm;
            window.ipcRenderer.invoke('terminal:resize', terminalId, cols, rows);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            removeOutputListener();
            removeExitListener();
            window.removeEventListener('resize', handleResize);
            window.ipcRenderer.invoke('terminal:destroy', terminalId);
            xterm.dispose();
        };
    }, [terminalId, cwd, onReady]);

    return <div ref={terminalRef} className="h-full w-full" />;
}
