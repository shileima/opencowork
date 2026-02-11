import { useEffect, useState, useRef, useCallback } from 'react';

interface SplashScreenProps {
    onComplete: () => void;
}

interface InitProgress {
    stage: string;
    progress: number;
    detail?: string;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const [progress, setProgress] = useState(0);
    const [loadingText, setLoadingText] = useState('正在初始化...');
    const [dots, setDots] = useState('');
    const completedRef = useRef(false);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    // React 挂载后，平滑移除 index.html 中的原生 loading
    useEffect(() => {
        const nativeSplash = document.getElementById('native-splash');
        if (nativeSplash) {
            // 添加淡出 class，等 CSS transition 结束后移除 DOM
            nativeSplash.classList.add('fade-out');
            const timer = setTimeout(() => {
                nativeSplash.remove();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, []);

    // 安全调用 onComplete，避免重复触发
    const handleComplete = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        // 让进度条到 100% 后短暂停留再消失
        setProgress(100);
        setLoadingText('启动完成');
        setTimeout(() => {
            onCompleteRef.current();
        }, 300);
    }, []);

    // 动画点点点效果
    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
        }, 400);
        return () => clearInterval(interval);
    }, []);

    // 监听主进程发送的真实初始化进度事件
    useEffect(() => {
        // 最小进度：确保进度只增不减
        let minProgress = 0;

        const removeProgressListener = window.ipcRenderer.on('app:init-progress', (_event: unknown, data: unknown) => {
            const { stage, progress: p } = data as InitProgress;
            const safeProgress = Math.max(minProgress, p);
            minProgress = safeProgress;
            setProgress(safeProgress);
            if (stage) setLoadingText(stage);
        });

        const removeCompleteListener = window.ipcRenderer.on('app:init-complete', () => {
            handleComplete();
        });

        // 超时保护：如果 15 秒内没有收到 init-complete，强制完成
        const timeoutId = setTimeout(() => {
            console.warn('[SplashScreen] Initialization timeout, forcing complete');
            handleComplete();
        }, 15000);

        // 快速 fallback：如果 300ms 内没有收到任何进度事件，启动模拟进度
        // 这处理开发模式或 IPC 事件未正确发送的情况
        let receivedProgress = false;
        const fallbackTimer = setTimeout(() => {
            if (!receivedProgress && !completedRef.current) {
                startSimulatedProgress();
            }
        }, 300);

        // 标记收到过进度事件
        const wrappedProgressListener = window.ipcRenderer.on('app:init-progress', () => {
            receivedProgress = true;
        });

        function startSimulatedProgress() {
            const stages = [
                { progress: 20, text: '加载配置', delay: 200 },
                { progress: 40, text: '初始化组件', delay: 400 },
                { progress: 60, text: '连接服务', delay: 500 },
                { progress: 80, text: '准备工作区', delay: 400 },
                { progress: 100, text: '启动完成', delay: 300 },
            ];

            let i = 0;
            const next = () => {
                if (completedRef.current || i >= stages.length) {
                    if (!completedRef.current) handleComplete();
                    return;
                }
                const stage = stages[i];
                setProgress(prev => Math.max(prev, stage.progress));
                setLoadingText(stage.text);
                i++;
                setTimeout(next, stage.delay);
            };
            next();
        }

        return () => {
            clearTimeout(timeoutId);
            clearTimeout(fallbackTimer);
            removeProgressListener();
            removeCompleteListener();
            wrappedProgressListener();
        };
    }, [handleComplete]);

    return (
        <div className="fixed inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-black flex items-center justify-center z-[9999]">
            {/* 背景动画效果 */}
            <div className="absolute inset-0 overflow-hidden">
                {/* 美团黄渐变光晕 - 主色调 */}
                <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#FFC300]/8 rounded-full blur-[150px] animate-pulse" />
                <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] bg-[#FFA500]/6 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
                
                {/* 动态网格背景 */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a_1px,transparent_1px),linear-gradient(to_bottom,#27272a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_70%,transparent_110%)] opacity-20" />
                
                {/* 扫描线效果 */}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#FFC300]/5 to-transparent animate-scan" />
            </div>

            {/* 主内容 */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Logo 和动画 */}
                <div className="relative mb-16">
                    {/* 外圈旋转光环 - 美团黄主题 */}
                    <div className="absolute inset-0 -m-10">
                        <div className="w-36 h-36 border-[3px] border-transparent border-t-[#FFC300]/50 border-r-[#FFC300]/30 rounded-full animate-spin" style={{ animationDuration: '3s' }} />
                    </div>
                    <div className="absolute inset-0 -m-8">
                        <div className="w-32 h-32 border-[2px] border-transparent border-b-[#FFA500]/40 border-l-[#FFA500]/20 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                    </div>
                    
                    {/* 中圈呼吸光环 */}
                    <div className="absolute inset-0 -m-6">
                        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#FFC300]/20 to-transparent animate-pulse" style={{ animationDuration: '2.5s' }} />
                    </div>

                    {/* Logo 容器 */}
                    <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-800 via-zinc-900 to-black border border-zinc-700/50 shadow-2xl shadow-[#FFC300]/10 flex items-center justify-center overflow-hidden">
                        {/* Logo 背景光效 - 美团黄 */}
                        <div className="absolute inset-0 bg-gradient-to-br from-[#FFC300]/15 via-[#FFA500]/10 to-transparent" />
                        
                        {/* Logo 图片 */}
                        <img 
                            src="./icon.png" 
                            alt="QACowork" 
                            className="w-12 h-12 rounded-lg object-cover relative z-10"
                        />
                        
                        {/* 脉冲效果 - 美团黄 */}
                        <div className="absolute inset-0 bg-[#FFC300]/25 rounded-2xl animate-ping" style={{ animationDuration: '2s' }} />
                    </div>
                </div>

                {/* 应用名称 */}
                <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-300 bg-clip-text text-transparent mb-3 tracking-tight">
                    QACowork
                </h1>
                <p className="text-zinc-400 text-sm mb-16 tracking-wide">
                    智能协作开发平台
                </p>

                {/* 资源准备状态指示器 */}
                <div className="mb-8 flex items-center gap-3">
                    {/* 旋转加载图标 */}
                    <div className="relative w-5 h-5">
                        <div className="absolute inset-0 border-2 border-[#FFC300]/30 border-t-[#FFC300] rounded-full animate-spin" />
                        <div className="absolute inset-1 border-2 border-[#FFA500]/20 border-b-[#FFA500] rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
                    </div>
                    <span className="text-[#FFC300] text-sm font-medium tracking-wide">
                        资源准备中{dots}
                    </span>
                </div>

                {/* 加载进度区域 */}
                <div className="w-96 space-y-5">
                    {/* 进度条容器 */}
                    <div className="relative">
                        {/* 进度条外框 */}
                        <div className="relative h-2 bg-zinc-800/80 rounded-full overflow-hidden border border-zinc-700/30 shadow-inner">
                            {/* 背景轨道光效 */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-700/20 to-transparent" />
                            
                            {/* 进度条 - 美团黄渐变 */}
                            <div 
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#FFA500] via-[#FFC300] to-[#FFD700] rounded-full transition-all duration-500 ease-out shadow-lg shadow-[#FFC300]/30"
                                style={{ width: `${progress}%` }}
                            >
                                {/* 进度条流动光效 */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                                
                                {/* 进度条顶部高光 */}
                                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                            </div>
                            
                            {/* 进度条末端光点 */}
                            {progress > 0 && (
                                <div 
                                    className="absolute inset-y-0 w-1.5 bg-white rounded-full shadow-[0_0_12px_rgba(255,195,0,0.8)] transition-all duration-500 ease-out"
                                    style={{ left: `${Math.min(progress, 99)}%` }}
                                />
                            )}
                        </div>
                        
                        {/* 进度条下方光晕 */}
                        <div 
                            className="absolute -bottom-2 left-0 h-4 bg-gradient-to-r from-[#FFC300]/20 to-transparent blur-xl transition-all duration-500 ease-out rounded-full"
                            style={{ width: `${progress}%` }}
                        />
                    </div>

                    {/* 加载文本和百分比 */}
                    <div className="flex items-center justify-between text-sm px-1">
                        <div className="flex items-center gap-2">
                            {/* 状态指示点 */}
                            <div className="w-1.5 h-1.5 rounded-full bg-[#FFC300] animate-pulse shadow-[0_0_8px_rgba(255,195,0,0.6)]" />
                            <span className="text-zinc-300 font-medium tracking-wide">
                                {loadingText}
                            </span>
                        </div>
                        <span className="text-[#FFC300] font-mono font-semibold tabular-nums inline-block text-right min-w-[3rem] tracking-wider">
                            {Math.round(progress)}%
                        </span>
                    </div>
                    
                    {/* 加载提示信息 */}
                    <div className="text-center pt-2">
                        <p className="text-xs text-zinc-500 tracking-wide">
                            正在加载核心组件和配置文件
                        </p>
                    </div>
                </div>

                {/* 底部提示 */}
                <div className="absolute bottom-12 text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-xs text-zinc-600">
                        <div className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span>Powered by Claude AI</span>
                        <div className="w-1 h-1 rounded-full bg-zinc-600" />
                    </div>
                    <p className="text-[10px] text-zinc-700 tracking-wider">
                        让工具成为工具，让你成为你
                    </p>
                </div>
            </div>

            {/* 自定义动画 */}
            <style>{`
                @keyframes shimmer {
                    0% {
                        transform: translateX(-100%);
                    }
                    100% {
                        transform: translateX(100%);
                    }
                }
                .animate-shimmer {
                    animation: shimmer 2s infinite;
                }
                
                @keyframes scan {
                    0% {
                        transform: translateY(-100%);
                    }
                    100% {
                        transform: translateY(100%);
                    }
                }
                .animate-scan {
                    animation: scan 4s ease-in-out infinite;
                }
            `}</style>
        </div>
    );
}
