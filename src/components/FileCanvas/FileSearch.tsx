/**
 * 文件搜索组件
 * File Search
 *
 * 搜索文件名和文件内容
 */

import { useState, useCallback } from 'react';
import React from 'react';
import { Search, X, File, Image, Code, Folder, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { logger } from '../../services/logger';

interface SearchResult {
    path: string;
    name: string;
    type: 'file' | 'directory';
    matches?: Array<{
        type: 'name' | 'content';
        line?: number;
        context?: string;
        preview?: string;
    }>;
}

interface FileSearchProps {
    workingDir: string | null;
    onResultClick: (path: string) => void;
    onClose: () => void;
}

export function FileSearch({ workingDir, onResultClick, onClose }: FileSearchProps) {
    const { t } = useI18n();
    const [query, setQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searchType, setSearchType] = useState<'name' | 'content'>('name');

    // Perform search
    const performSearch = useCallback(async (searchQuery: string, type: 'name' | 'content') => {
        if (!searchQuery.trim() || !workingDir) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const result = await window.ipcRenderer.invoke('file:search', {
                query: searchQuery,
                type,
                basePath: workingDir
            });

            setResults((result || []) as SearchResult[]);
        } catch (error) {
            logger.error('Search failed:', error);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    }, [workingDir]);

    // Debounced search
    const debouncedSearch = useCallback(
        debounce((q: string, t: 'name' | 'content') => {
            performSearch(q, t);
        }, 300),
        [performSearch]
    );

    // Handle query change
    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);
        debouncedSearch(value, searchType);
    }, [debouncedSearch, searchType]);

    // Handle search type change
    const handleTypeChange = useCallback((type: 'name' | 'content') => {
        setSearchType(type);
        if (query.trim()) {
            performSearch(query, type);
        }
    }, [query, performSearch]);

    // Clear search
    const handleClear = useCallback(() => {
        setQuery('');
        setResults([]);
    }, []);

    // Get file icon
    const getFileIcon = (result: SearchResult) => {
        if (result.type === 'directory') {
            return Folder;
        }

        const ext = result.name.split('.').pop()?.toLowerCase();

        if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp'].includes(ext || '')) {
            return Image;
        }

        if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs'].includes(ext || '')) {
            return Code;
        }

        return File;
    };

    // Highlight matching text
    const highlightMatch = useCallback((text: string, query: string) => {
        if (!query) return text;

        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        const parts = text.split(regex);

        return parts.map((part, idx) =>
            regex.test(part) ? (
                <mark key={idx} className="bg-orange-200 dark:bg-orange-800 text-orange-900 dark:text-orange-100 rounded px-0.5">
                    {part}
                </mark>
            ) : (
                part
            )
        );
    }, []);

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900">
            {/* Search Header */}
            <div className="flex flex-col border-b border-stone-200 dark:border-zinc-800 bg-gradient-to-b from-stone-50 to-white dark:from-zinc-900 dark:to-zinc-900">
                {/* Search Input */}
                <div className="flex items-center gap-2 px-4 py-3">
                    <div className="flex-1 flex items-center gap-2 bg-white dark:bg-zinc-800 rounded-xl px-3 py-2.5 border border-stone-200 dark:border-zinc-700 focus-within:border-blue-400 dark:focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-900/30 transition-all shadow-sm">
                        <Search size={18} className="text-stone-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            placeholder={t('searchFilesPlaceholder')}
                            className="flex-1 bg-transparent text-sm text-stone-700 dark:text-zinc-200 placeholder-stone-400 outline-none"
                            autoFocus
                        />
                        {query && (
                            <button
                                onClick={handleClear}
                                className="p-0.5 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-lg transition-all"
                                title={t('clear')}
                            >
                                <X size={16} className="text-stone-400" />
                            </button>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-stone-200 dark:hover:bg-zinc-700 rounded-xl transition-all"
                        title={t('close')}
                    >
                        <X size={18} className="text-stone-500 dark:text-zinc-400" />
                    </button>
                </div>

                {/* Search Type Toggle */}
                <div className="flex items-center justify-between px-4 pb-3">
                    <div className="flex items-center gap-1.5 bg-stone-100 dark:bg-zinc-800 rounded-lg p-1">
                        <button
                            onClick={() => handleTypeChange('name')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                                searchType === 'name'
                                    ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                        >
                            <File size={14} />
                            {t('byName')}
                        </button>
                        <button
                            onClick={() => handleTypeChange('content')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                                searchType === 'content'
                                    ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm'
                                    : 'text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                        >
                            <Search size={14} />
                            {t('byContent')}
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="text-xs text-stone-500 dark:text-zinc-400">
                        {isSearching ? (
                            <span className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" />
                                {t('searching')}
                            </span>
                        ) : results.length > 0 ? (
                            <span>{t('foundResults', { count: results.length }) || `找到 ${results.length} 个结果`}</span>
                        ) : query ? (
                            <span>{t('noResults')}</span>
                        ) : (
                            <span>{t('startSearch')}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Search Results */}
            <div className="flex-1 overflow-y-auto">
                {isSearching ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                            <p className="text-sm text-stone-500 dark:text-zinc-400">{t('searchingInProgress')}</p>
                        </div>
                    </div>
                ) : results.length === 0 && query ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Search size={48} className="mx-auto text-stone-300 dark:text-zinc-600 mb-3" />
                            <p className="text-sm text-stone-500 dark:text-zinc-400 mb-1">{t('noResultsFound')}</p>
                            <p className="text-xs text-stone-400 dark:text-zinc-500">{t('tryDifferentKeywords')}</p>
                        </div>
                    </div>
                ) : results.length === 0 && !query ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <Sparkles size={48} className="mx-auto text-blue-400 dark:text-blue-500 mb-3" />
                            <p className="text-sm text-stone-600 dark:text-zinc-300 mb-1">{t('quickSearchFiles')}</p>
                            <p className="text-xs text-stone-400 dark:text-zinc-500">{t('searchByNameOrContent')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="p-3 space-y-2">
                        {results.map((result, idx) => (
                            <div
                                key={idx}
                                className="group flex items-start gap-3 p-3 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer transition-all border border-transparent hover:border-stone-200 dark:hover:border-zinc-700"
                                onClick={() => onResultClick(result.path)}
                            >
                                {/* Icon */}
                                <div className="mt-0.5 shrink-0">
                                    {React.createElement(getFileIcon(result), {
                                        size: 20,
                                        className: result.type === 'directory'
                                            ? 'text-blue-500'
                                            : 'text-stone-500'
                                    })}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    {/* File name with highlight */}
                                    <div className="text-sm font-medium text-stone-700 dark:text-zinc-300 truncate mb-0.5">
                                        {highlightMatch(result.name, query)}
                                    </div>

                                    {/* Path */}
                                    <div className="text-xs text-stone-400 dark:text-zinc-500 truncate mb-1">
                                        {result.path}
                                    </div>

                                    {/* Content matches */}
                                    {searchType === 'content' && result.matches && result.matches.length > 0 && (
                                        <div className="space-y-1.5">
                                            {result.matches.slice(0, 3).map((match, matchIdx) => (
                                                <div
                                                    key={matchIdx}
                                                    className="text-xs bg-stone-50 dark:bg-zinc-900 rounded-lg px-2.5 py-1.5 border border-stone-100 dark:border-zinc-800"
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        {match.line !== undefined && (
                                                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-200 dark:bg-zinc-700 rounded text-stone-600 dark:text-zinc-400">
                                                                {t('line', { line: match.line }) || `行 ${match.line}`}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="text-stone-600 dark:text-zinc-400 font-mono leading-relaxed block truncate">
                                                        {match.preview && highlightMatch(match.preview, query)}
                                                    </span>
                                                </div>
                                            ))}
                                            {result.matches.length > 3 && (
                                                <div className="text-xs text-stone-400 dark:text-zinc-500 flex items-center gap-1">
                                                    <div className="h-px flex-1 bg-stone-200 dark:bg-zinc-700" />
                                                    <span>{t('moreMatches', { count: result.matches.length - 3 }) || `还有 ${result.matches.length - 3} 处匹配`}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Debounce utility
 */
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;

    return function executedFunction(...args: Parameters<T>) {
        const later = () => {
            timeout = null;
            func(...args);
        };

        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(later, wait);
    };
}
