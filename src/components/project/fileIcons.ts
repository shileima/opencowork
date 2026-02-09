import {
    File,
    FileCode,
    FileBraces,
    FileText,
    FileType,
    FileImage,
    FileTerminal,
    FileArchive,
    FileCog,
    FileKey,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 文件图标配置，与资源管理器一致 */
export interface FileIconConfig {
    icon: LucideIcon;
    colorClass: string;
}

/** 根据文件名/扩展名返回图标与配色，与资源管理器保持一致 */
export function getFileIconConfig(fileName: string): FileIconConfig {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const name = fileName.toLowerCase();

    if (name.startsWith('.env') || name === '.env') {
        return { icon: FileKey, colorClass: 'text-emerald-500' };
    }
    if (name === '.gitignore' || name === '.gitattributes') {
        return { icon: File, colorClass: 'text-zinc-400' };
    }
    if (name === '.npmrc') {
        return { icon: File, colorClass: 'text-red-400' };
    }
    if (name === 'license' || name.startsWith('license.')) {
        return { icon: FileKey, colorClass: 'text-amber-400' };
    }
    if (ext === 'json' || ext === 'json5' || name.endsWith('.json5')) {
        return { icon: FileBraces, colorClass: 'text-amber-400' };
    }
    if (name.startsWith('tsconfig') && (ext === 'json' || name.endsWith('.json'))) {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['md', 'mdx', 'markdown'].includes(ext || '')) {
        return { icon: FileText, colorClass: 'text-blue-400' };
    }
    if (['txt', 'rst', 'log'].includes(ext || '')) {
        return { icon: FileText, colorClass: 'text-zinc-400' };
    }
    if (['html', 'htm', 'xhtml'].includes(ext || '')) {
        return { icon: FileType, colorClass: 'text-orange-400' };
    }
    if (ext === 'xml' || ext === 'svg') {
        return { icon: FileType, colorClass: 'text-amber-500' };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(ext || '')) {
        return { icon: FileImage, colorClass: 'text-pink-400' };
    }
    if (['sh', 'bash', 'zsh'].includes(ext || '')) {
        return { icon: FileTerminal, colorClass: 'text-emerald-400' };
    }
    if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].includes(ext || '')) {
        return { icon: FileArchive, colorClass: 'text-amber-500' };
    }
    if (name.includes('vite.config')) {
        return { icon: Zap, colorClass: 'text-amber-400' };
    }
    if (name.includes('eslint') || name === '.eslintrc' || name === '.eslintrc.cjs' || name === '.eslintrc.js') {
        return { icon: FileCog, colorClass: 'text-purple-400' };
    }
    if (
        name.endsWith('.config.js') ||
        name.endsWith('.config.ts') ||
        name.endsWith('.config.cjs') ||
        name.endsWith('.config.mjs') ||
        name === '.babelrc' ||
        name === '.babelrc.js' ||
        name === 'webpack.config.js' ||
        name === 'tailwind.config.cjs' ||
        name === 'postcss.config.cjs' ||
        name === 'postcss.config.js'
    ) {
        return { icon: FileCog, colorClass: 'text-amber-500' };
    }
    if (['ts', 'tsx', 'mts', 'cts'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['js', 'jsx', 'mjs', 'cjs'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-yellow-500' };
    }
    if (ext === 'css') {
        return { icon: FileCode, colorClass: 'text-blue-400' };
    }
    if (['scss', 'sass', 'less'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-pink-400' };
    }
    if (['yaml', 'yml'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-rose-400' };
    }
    if (ext === 'py') {
        return { icon: FileCode, colorClass: 'text-sky-400' };
    }
    if (ext === 'go') {
        return { icon: FileCode, colorClass: 'text-cyan-400' };
    }
    if (ext === 'rs') {
        return { icon: FileCode, colorClass: 'text-orange-500' };
    }
    if (['java', 'cpp', 'c', 'h', 'hpp', 'php', 'rb', 'sql', 'kt', 'swift'].includes(ext || '')) {
        return { icon: FileCode, colorClass: 'text-slate-400' };
    }
    return { icon: File, colorClass: 'text-zinc-500' };
}
