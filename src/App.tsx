import { useState, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { CoworkView } from './components/CoworkView';
import { SettingsView } from './components/SettingsView';
import { ConfirmDialog, useConfirmations } from './components/ConfirmDialog';
import { FloatingBallPage } from './components/FloatingBallPage';
import Anthropic from '@anthropic-ai/sdk';

function App() {
  const [history, setHistory] = useState<Anthropic.MessageParam[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { pendingRequest, handleConfirm, handleDeny } = useConfirmations();

  // Check if this is the floating ball window
  const isFloatingBall = window.location.hash === '#/floating-ball' || window.location.hash === '#floating-ball';

  const handleSessionChange = (id: string) => {
    setSessionId(id);
    window.ipcRenderer.invoke('session:load', id);
    // session:load will trigger agent:update which sets history
  };

  useEffect(() => {
    // Initialize session
    window.ipcRenderer.invoke('session:current').then((session: any) => {
      if (session && session.id) {
        handleSessionChange(session.id);
      } else {
        window.ipcRenderer.invoke('agent:new-session').then((res: any) => {
          if (res.sessionId) handleSessionChange(res.sessionId);
        });
      }
    });

    // Listen for history updates
    const removeListener = window.ipcRenderer.on('agent:update', (_event, ...args) => {
      const data = args[0] as { sessionId: string, history: Anthropic.MessageParam[], isProcessing: boolean };
      // Always update if it matches current session OR if we don't have a session yet (shouldn't happen often)
      if (sessionId && data.sessionId !== sessionId) return;

      setHistory(data.history || []);
      setIsProcessing(data.isProcessing);

      // If we somehow didn't have a session ID but received an update (race condition?), sync it potentially?
      // But safer to rely on explicit switching.
    });

    const removeErrorListener = window.ipcRenderer.on('agent:error', (_event, ...args) => {
      const data = args[0] as { sessionId: string, error: string } | string;
      const err = typeof data === 'string' ? data : data.error;
      const errSessionId = typeof data === 'string' ? null : data.sessionId;

      if (errSessionId && sessionId && errSessionId !== sessionId) return;

      console.error("Agent Error:", err);
      setIsProcessing(false);
    });

    const removeAbortListener = window.ipcRenderer.on('agent:aborted', (_event, ...args) => {
      const data = args[0] as { sessionId: string };
      if (sessionId && data.sessionId !== sessionId) return;
      setIsProcessing(false);
    });

    // Only reset isProcessing when processing is truly done
    const removeDoneListener = window.ipcRenderer.on('agent:done', (_event, ...args) => {
      const data = args[0] as { sessionId: string };
      if (sessionId && data.sessionId !== sessionId) return;
      setIsProcessing(false);
    });

    return () => {
      removeListener();
      removeErrorListener();
      removeAbortListener();
      removeDoneListener();
    };
  }, [sessionId]); // Re-bind listeners when sessionId changes to capture correct closure if needed, though filtered by state is better

  const handleSendMessage = async (msg: string | { content: string, images: string[] }) => {
    if (!sessionId) return;
    setIsProcessing(true);
    try {
      const result = await window.ipcRenderer.invoke('agent:send-message', { sessionId, input: msg }) as { error?: string } | undefined;
      if (result?.error) {
        console.error(result.error);
        setIsProcessing(false);
      }
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  const handleAbort = () => {
    if (!sessionId) return;
    window.ipcRenderer.invoke('agent:abort', sessionId);
    setIsProcessing(false);
  };

  // If this is the floating ball window, render only the floating ball
  if (isFloatingBall) {
    return <FloatingBallPage />;
  }

  // Main App - Narrow vertical layout
  return (
    <div className="h-screen w-full bg-[#FAF8F5] dark:bg-zinc-950 flex flex-col overflow-hidden font-sans text-stone-900 dark:text-zinc-100">
      {/* Custom Titlebar */}
      <header
        className={`h-10 border-b border-stone-200/80 dark:border-zinc-800 flex items-center justify-between px-3 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm shrink-0 transition-colors ${window.platform === 'darwin' ? 'pl-20' : ''}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <img src="./icon.png" alt="Logo" className="w-6 h-6 rounded-md object-cover" />
          <span className="font-medium text-stone-700 dark:text-zinc-200 text-sm">OpenCowork</span>
        </div>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Window Controls - Windows/Linux only */}
          {window.platform !== 'darwin' && (
            <>
              <button
                onClick={() => window.ipcRenderer.invoke('window:minimize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded transition-colors"
                title="Minimize"
              >
                <Minus size={14} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:maximize')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800 rounded transition-colors"
                title="Maximize"
              >
                <Square size={12} />
              </button>
              <button
                onClick={() => window.ipcRenderer.invoke('window:close')}
                className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-red-100 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        <CoworkView
          sessionId={sessionId}
          history={history}
          onSendMessage={handleSendMessage}
          onAbort={handleAbort}
          isProcessing={isProcessing}
          onOpenSettings={() => setShowSettings(true)}
          onSessionChange={handleSessionChange}
        />
        {showSettings && (
          <div className="absolute inset-0 z-50">
            <SettingsView onClose={() => setShowSettings(false)} />
          </div>
        )}
      </main>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        request={pendingRequest}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
      />
    </div>
  );
}

export default App;
