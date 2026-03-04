import { useState, useEffect, useCallback } from 'react';
import { Loader2, LogIn, User, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface UserInfo {
    name: string;
    subject: string;
    mtEmpId: number;
    expire: number;
}

type LoginStatus = 'checking' | 'logged-in' | 'need-login' | 'logging-in' | 'error';

interface SsoLoginViewProps {
    /** 登录成功后回调 */
    onLoginSuccess: (userInfo: UserInfo) => void;
}

export const SsoLoginView = ({ onLoginSuccess }: SsoLoginViewProps) => {
    const [status, setStatus] = useState<LoginStatus>('checking');
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [pollingInterval, setPollingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            setPollingInterval(null);
        }
    }, [pollingInterval]);

    // 检查 SSO 会话
    const checkSession = useCallback(async (): Promise<boolean> => {
        try {
            const result = await window.ipcRenderer.invoke('sso:check-session') as {
                loggedIn: boolean;
                userInfo: UserInfo | null;
            };
            if (result.loggedIn && result.userInfo) {
                setUserInfo(result.userInfo);
                setStatus('logged-in');
                stopPolling();
                onLoginSuccess(result.userInfo);
                return true;
            }
            return false;
        } catch (err) {
            console.error('[SsoLoginView] check-session error:', err);
            return false;
        }
    }, [onLoginSuccess, stopPolling]);

    // 初始检查
    useEffect(() => {
        const init = async () => {
            const loggedIn = await checkSession();
            if (!loggedIn) {
                setStatus('need-login');
            }
        };
        init();
    }, [checkSession]);

    // 监听主进程登录成功事件
    useEffect(() => {
        const removeListener = window.ipcRenderer.on('sso:login-success', (_event, ...args) => {
            const payload = args[0] as { userInfo: UserInfo };
            if (payload?.userInfo) {
                setUserInfo(payload.userInfo);
                setStatus('logged-in');
                stopPolling();
                onLoginSuccess(payload.userInfo);
            }
        });
        return () => {
            removeListener();
            stopPolling();
        };
    }, [onLoginSuccess, stopPolling]);

    // 发起登录：打开 Electron 内置登录窗口
    // 主进程会在检测到已登录（Cookie/JS token）后发送 sso:login-success 事件
    const handleLogin = async () => {
        setStatus('logging-in');
        setErrorMsg('');

        try {
            // 异步调用，不阻塞 UI；登录结果通过 sso:login-success 事件或 result 返回
            window.ipcRenderer.invoke('sso:start-login').then((result: unknown) => {
                const r = result as { success: boolean; error?: string; userInfo?: UserInfo };
                // 若窗口被关闭（无 success）且尚未被事件处理过，恢复为 need-login
                if (!r.success && r.error === '登录窗口已关闭') {
                    setStatus((prev) => prev === 'logging-in' ? 'need-login' : prev);
                } else if (!r.success && r.error) {
                    setStatus((prev) => prev === 'logging-in' ? 'error' : prev);
                    setErrorMsg(r.error);
                }
                // 成功情况由 sso:login-success 事件处理，此处不重复处理
            }).catch((err: Error) => {
                setStatus((prev) => prev === 'logging-in' ? 'error' : prev);
                setErrorMsg(err.message || '登录请求失败');
            });
        } catch (err) {
            setStatus('error');
            setErrorMsg((err as Error).message || '未知错误');
        }
    };

    const handleRetry = () => {
        setStatus('need-login');
        setErrorMsg('');
        stopPolling();
    };

    // ─── checking ────────────────────────────────────────────────────────────
    if (status === 'checking') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-stone-500 dark:text-zinc-400">
                <Loader2 size={32} className="animate-spin text-orange-400" />
                <p className="text-sm">正在检查登录状态...</p>
            </div>
        );
    }

    // ─── logged-in ────────────────────────────────────────────────────────────
    if (status === 'logged-in' && userInfo) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <CheckCircle size={40} className="text-green-500" />
                <div className="text-center">
                    <p className="font-semibold text-stone-800 dark:text-zinc-100">{userInfo.name}</p>
                    <p className="text-sm text-stone-500 dark:text-zinc-400">{userInfo.subject}</p>
                </div>
                <p className="text-xs text-stone-400 dark:text-zinc-500">已登录美团 SSO</p>
            </div>
        );
    }

    // ─── error ────────────────────────────────────────────────────────────────
    if (status === 'error') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
                <AlertCircle size={36} className="text-red-500" />
                <div className="text-center space-y-1">
                    <p className="font-medium text-stone-800 dark:text-zinc-100">登录失败</p>
                    <p className="text-sm text-stone-500 dark:text-zinc-400">{errorMsg}</p>
                </div>
                <button
                    type="button"
                    onClick={handleRetry}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-stone-100 hover:bg-stone-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-stone-700 dark:text-zinc-200 transition-colors"
                    aria-label="重试登录"
                >
                    <RefreshCw size={15} />
                    重试
                </button>
            </div>
        );
    }

    // ─── need-login / logging-in ──────────────────────────────────────────────
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
            {/* Logo & 标题 */}
            <div className="flex flex-col items-center gap-3">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg">
                    <img src="./icon.png" alt="QACowork" className="w-10 h-10 rounded-xl object-cover" />
                </div>
                <div className="text-center">
                    <h1 className="text-xl font-bold text-stone-900 dark:text-zinc-100">QACowork</h1>
                    <p className="text-sm text-stone-500 dark:text-zinc-400 mt-0.5">需要美团 SSO 登录以继续使用</p>
                </div>
            </div>

            {/* 登录卡片 */}
            <div className="w-full max-w-xs bg-white dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
                        <User size={16} className="text-orange-500" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-stone-800 dark:text-zinc-100">美团 SSO 登录</p>
                        <p className="text-xs text-stone-400 dark:text-zinc-500">使用大象扫码登录</p>
                    </div>
                </div>

                <div className="border-t border-stone-100 dark:border-zinc-700" />

                <ul className="space-y-1.5 text-xs text-stone-500 dark:text-zinc-400">
                    <li className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />
                        点击下方按钮，将在系统浏览器打开 SSO 登录页
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />
                        使用大象 App 扫码完成登录
                    </li>
                    <li className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-orange-400 shrink-0" />
                        登录成功后自动跳转，无需重复操作
                    </li>
                </ul>

                <button
                    type="button"
                    onClick={handleLogin}
                    disabled={status === 'logging-in'}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        status === 'logging-in'
                            ? 'bg-orange-400 text-white cursor-not-allowed'
                            : 'bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white shadow-sm hover:shadow'
                    }`}
                    aria-label="扫码登录"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                >
                    {status === 'logging-in' ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            等待扫码登录...
                        </>
                    ) : (
                        <>
                            <LogIn size={16} />
                            扫码登录
                        </>
                    )}
                </button>

                {status === 'logging-in' && (
                    <p className="text-center text-xs text-stone-400 dark:text-zinc-500">
                        请在弹出的浏览器窗口中扫码，完成后将自动跳转
                    </p>
                )}
            </div>

            <p className="text-xs text-stone-400 dark:text-zinc-500 text-center max-w-xs">
                登录信息将加密保存在本地，下次启动无需重复登录
            </p>
        </div>
    );
};
