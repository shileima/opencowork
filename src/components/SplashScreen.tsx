import { useEffect, useState } from 'react';

interface SplashScreenProps {
    onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
    const [progress, setProgress] = useState(0);
    const [loadingText, setLoadingText] = useState('正在初始化...');
    const [dots, setDots] = useState('');

    // 动画点点点效果
    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
        }, 400);
        return () => clearInterval(interval);
    }, []);

    // 模拟加载进度
    useEffect(() => {
        const stages = [
            { progress: 20, text: '加载配置', duration: 200 },
            { progress: 40, text: '初始化组件', duration: 300 },
            { progress: 60, text: '连接服务', duration: 250 },
            { progress: 80, text: '准备工作区', duration: 200 },
            { progress: 100, text: '启动完成', duration: 150 },
        ];

        let currentStage = 0;
        let currentProgress = 0;

        const animate = () => {
            if (currentStage >= stages.length) {
                // 延迟一点再完成，让用户看到 100%
                setTimeout(() => onComplete(), 300);
                return;
            }

            const stage = stages[currentStage];
            const increment = (stage.progress - currentProgress) / 10;

            const progressInterval = setInterval(() => {
                currentProgress += increment;
                setProgress(Math.min(currentProgress, stage.progress));

                if (currentProgress >= stage.progress) {
                    clearInterval(progressInterval);
                    setLoadingText(stage.text);
                    currentStage++;
                    setTimeout(animate, stage.duration);
                }
            }, 30);
        };

        // 延迟启动，确保组件已挂载
        const timer = setTimeout(animate, 100);
        return () => clearTimeout(timer);
    }, [onComplete]);

    return (
        <div className="fixed inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center z-[9999]">
            {/* 背景动画效果 */}
            <div className="absolute inset-0 overflow-hidden">
                {/* 渐变光晕 */}
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
                
                {/* 网格背景 */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a_1px,transparent_1px),linear-gradient(to_bottom,#27272a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,#000_70%,transparent_110%)] opacity-20" />
            </div>

            {/* 主内容 */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Logo 和动画 */}
                <div className="relative mb-12">
                    {/* 外圈旋转光环 */}
                    <div className="absolute inset-0 -m-8">
                        <div className="w-32 h-32 border-2 border-transparent border-t-orange-500/40 border-r-orange-500/20 rounded-full animate-spin" style={{ animationDuration: '3s' }} />
                    </div>
                    <div className="absolute inset-0 -m-6">
                        <div className="w-28 h-28 border-2 border-transparent border-b-blue-500/30 border-l-blue-500/15 rounded-full animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />
                    </div>

                    {/* Logo 容器 */}
                    <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 border border-zinc-700/50 shadow-2xl flex items-center justify-center overflow-hidden">
                        {/* Logo 背景光效 */}
                        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent" />
                        
                        {/* Logo 图片 */}
                        <img 
                            src="./icon.png" 
                            alt="QACowork" 
                            className="w-12 h-12 rounded-lg object-cover relative z-10"
                        />
                        
                        {/* 脉冲效果 */}
                        <div className="absolute inset-0 bg-orange-500/20 rounded-2xl animate-ping" style={{ animationDuration: '2s' }} />
                    </div>
                </div>

                {/* 应用名称 */}
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
                    QACowork
                </h1>
                <p className="text-zinc-400 text-sm mb-12">
                    智能协作开发平台
                </p>

                {/* 加载进度区域 */}
                <div className="w-80 space-y-4">
                    {/* 进度条 */}
                    <div className="relative h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        {/* 背景轨道光效 */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-700/30 to-transparent" />
                        
                        {/* 进度条 */}
                        <div 
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-500 via-orange-400 to-orange-500 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                        >
                            {/* 进度条光效 */}
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                        </div>
                        
                        {/* 进度条末端光点 */}
                        {progress > 0 && (
                            <div 
                                className="absolute inset-y-0 w-1 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-300 ease-out"
                                style={{ left: `${progress}%` }}
                            />
                        )}
                    </div>

                    {/* 加载文本和百分比 */}
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400 font-medium">
                            {loadingText}{dots}
                        </span>
                        <span className="text-zinc-500 font-mono tabular-nums">
                            {Math.round(progress)}%
                        </span>
                    </div>
                </div>

                {/* 底部提示 */}
                <div className="absolute bottom-12 text-center">
                    <p className="text-xs text-zinc-600">
                        Powered by Claude AI
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
            `}</style>
        </div>
    );
}
