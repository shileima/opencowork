/**
 * 文件差异对比组件
 * File Diff
 *
 * 显示文件的版本差异，支持统一视图和并排视图
 */

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Eye, Columns, FileText } from 'lucide-react';

interface DiffLine {
    type: 'added' | 'removed' | 'unchanged' | 'header';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
}

interface FileDiffProps {
    oldContent: string;
    newContent: string;
    oldFileName?: string;
    newFileName?: string;
}

export function FileDiff({ oldContent, newContent, oldFileName, newFileName }: FileDiffProps) {
    const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('unified');
    const [contextLines, _setContextLines] = useState(3); // Number of context lines to show around changes

    // Compute diff
    const diffLines = useMemo(() => {
        return computeDiff(oldContent, newContent);
    }, [oldContent, newContent]);

    // Filter by context (only show changes with N lines of context)
    const filteredLines = useMemo(() => {
        if (contextLines === 0) return diffLines; // Show all

        const result: DiffLine[] = [];
        let inChangeRegion = false;
        let linesSinceChange = 0;

        for (const line of diffLines) {
            if (line.type === 'added' || line.type === 'removed') {
                inChangeRegion = true;
                linesSinceChange = 0;
                result.push(line);
            } else if (inChangeRegion) {
                if (linesSinceChange < contextLines) {
                    result.push(line);
                    linesSinceChange++;
                } else {
                    inChangeRegion = false;
                }
            }
        }

        return result;
    }, [diffLines, contextLines]);

    const stats = useMemo(() => {
        const additions = diffLines.filter(l => l.type === 'added').length;
        const deletions = diffLines.filter(l => l.type === 'removed').length;
        return { additions, deletions };
    }, [diffLines]);

    return (
        <div className="h-full flex flex-col bg-white dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-stone-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    <FileText size={16} className="text-stone-600 dark:text-zinc-400" />
                    <span className="text-sm font-medium text-stone-700 dark:text-zinc-300">Diff</span>

                    {/* Stats */}
                    <div className="flex items-center gap-2 ml-4 text-xs">
                        <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
                        <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {/* View Mode Toggle */}
                    <button
                        onClick={() => setViewMode('unified')}
                        className={`p-1.5 rounded transition-colors ${
                            viewMode === 'unified'
                                ? 'bg-stone-200 dark:bg-zinc-700 text-stone-700 dark:text-zinc-200'
                                : 'text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                        title="Unified View"
                    >
                        <Eye size={14} />
                    </button>
                    <button
                        onClick={() => setViewMode('side-by-side')}
                        className={`p-1.5 rounded transition-colors ${
                            viewMode === 'side-by-side'
                                ? 'bg-stone-200 dark:bg-zinc-700 text-stone-700 dark:text-zinc-200'
                                : 'text-stone-500 hover:bg-stone-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                        }`}
                        title="Side by Side View"
                    >
                        <Columns size={14} />
                    </button>
                </div>
            </div>

            {/* File Names Header */}
            {(oldFileName || newFileName) && (
                <div className="px-4 py-2 bg-stone-50 dark:bg-zinc-800 border-b border-stone-200 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-xs">
                        {oldFileName && (
                            <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                <ChevronLeft size={12} />
                                <span className="font-mono">{oldFileName}</span>
                            </div>
                        )}
                        <ChevronRight size={12} className="text-stone-400" />
                        {newFileName && (
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                <ChevronRight size={12} />
                                <span className="font-mono">{newFileName}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Diff Content */}
            <div className="flex-1 overflow-auto">
                {viewMode === 'unified' ? (
                    <UnifiedDiffView lines={filteredLines} />
                ) : (
                    <SideBySideDiffView lines={filteredLines} />
                )}
            </div>
        </div>
    );
}

/**
 * Unified diff view - shows all changes in one column
 */
function UnifiedDiffView({ lines }: { lines: DiffLine[] }) {
    return (
        <div className="text-xs font-mono">
            {lines.map((line, idx) => (
                <div
                    key={idx}
                    className={`flex gap-3 px-4 py-0.5 border-b border-stone-100 dark:border-zinc-800 ${
                        line.type === 'added'
                            ? 'bg-green-50 dark:bg-green-900/20'
                            : line.type === 'removed'
                            ? 'bg-red-50 dark:bg-red-900/20'
                            : ''
                    }`}
                >
                    {/* Old line number */}
                    <div className="w-8 text-right text-stone-400 dark:text-zinc-600 flex-shrink-0 select-none">
                        {line.oldLineNumber !== undefined ? line.oldLineNumber : ''}
                    </div>

                    {/* New line number */}
                    <div className="w-8 text-right text-stone-400 dark:text-zinc-600 flex-shrink-0 select-none">
                        {line.newLineNumber !== undefined ? line.newLineNumber : ''}
                    </div>

                    {/* Content */}
                    <div
                        className={`flex-1 whitespace-pre ${
                            line.type === 'added'
                                ? 'text-green-700 dark:text-green-300'
                                : line.type === 'removed'
                                ? 'text-red-700 dark:text-red-300'
                                : 'text-stone-600 dark:text-zinc-400'
                        }`}
                    >
                        {line.type === 'added' && <span className="mr-2 select-none">+</span>}
                        {line.type === 'removed' && <span className="mr-2 select-none">-</span>}
                        {line.type === 'unchanged' && <span className="mr-2 select-none"> </span>}
                        {line.content || ' '}
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Side-by-side diff view - shows old and new versions side by side
 */
function SideBySideDiffView({ lines }: { lines: DiffLine[] }) {
    const pairs = useMemo(() => {
        const result: Array<{ left?: DiffLine; right?: DiffLine }> = [];
        let leftBuffer: DiffLine[] = [];
        let rightBuffer: DiffLine[] = [];

        for (const line of lines) {
            if (line.type === 'removed') {
                leftBuffer.push(line);
            } else if (line.type === 'added') {
                rightBuffer.push(line);
            } else {
                // Flush buffers
                while (leftBuffer.length > 0 || rightBuffer.length > 0) {
                    result.push({
                        left: leftBuffer.shift(),
                        right: rightBuffer.shift()
                    });
                }
                result.push({ left: line, right: line });
            }
        }

        // Flush remaining
        while (leftBuffer.length > 0 || rightBuffer.length > 0) {
            result.push({
                left: leftBuffer.shift(),
                right: rightBuffer.shift()
            });
        }

        return result;
    }, [lines]);

    return (
        <div className="text-xs font-mono">
            {pairs.map((pair, idx) => (
                <div
                    key={idx}
                    className="flex border-b border-stone-100 dark:border-zinc-800"
                >
                    {/* Left side - old version */}
                    <div className="flex-1 flex gap-2 px-3 py-0.5 border-r border-stone-200 dark:border-zinc-700">
                        <div className="w-6 text-right text-stone-400 dark:text-zinc-600 flex-shrink-0 select-none">
                            {pair.left?.oldLineNumber ?? ''}
                        </div>
                        <div
                            className={`flex-1 whitespace-pre ${
                                pair.left?.type === 'removed'
                                    ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                                    : 'text-stone-600 dark:text-zinc-400'
                            }`}
                        >
                            {pair.left?.type === 'removed' && <span className="select-none">-</span>}
                            {pair.left?.content ?? '\u00A0'}
                        </div>
                    </div>

                    {/* Right side - new version */}
                    <div className="flex-1 flex gap-2 px-3 py-0.5">
                        <div className="w-6 text-right text-stone-400 dark:text-zinc-600 flex-shrink-0 select-none">
                            {pair.right?.newLineNumber ?? ''}
                        </div>
                        <div
                            className={`flex-1 whitespace-pre ${
                                pair.right?.type === 'added'
                                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                                    : 'text-stone-600 dark:text-zinc-400'
                            }`}
                        >
                            {pair.right?.type === 'added' && <span className="select-none">+</span>}
                            {pair.right?.content ?? '\u00A0'}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Simple line-by-line diff algorithm
 * For production, consider using a proper diff library like 'diff' or 'jsdiff'
 */
function computeDiff(oldContent: string, newContent: string): DiffLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Use a simple LCS (Longest Common Subsequence) approach
    const lcs = computeLCS(oldLines, newLines);

    const result: DiffLine[] = [];
    let oldIdx = 0;
    let newIdx = 0;

    for (const match of lcs) {
        // Add deletions (old lines that don't match)
        while (oldIdx < match.oldIndex) {
            result.push({
                type: 'removed',
                oldLineNumber: oldIdx + 1,
                content: oldLines[oldIdx]
            });
            oldIdx++;
        }

        // Add additions (new lines that don't match)
        while (newIdx < match.newIndex) {
            result.push({
                type: 'added',
                newLineNumber: newIdx + 1,
                content: newLines[newIdx]
            });
            newIdx++;
        }

        // Add matching line
        result.push({
            type: 'unchanged',
            oldLineNumber: match.oldIndex + 1,
            newLineNumber: match.newIndex + 1,
            content: oldLines[match.oldIndex]
        });
        oldIdx++;
        newIdx++;
    }

    // Add remaining old lines (deletions)
    while (oldIdx < oldLines.length) {
        result.push({
            type: 'removed',
            oldLineNumber: oldIdx + 1,
            content: oldLines[oldIdx]
        });
        oldIdx++;
    }

    // Add remaining new lines (additions)
    while (newIdx < newLines.length) {
        result.push({
            type: 'added',
            newLineNumber: newIdx + 1,
            content: newLines[newIdx]
        });
        newIdx++;
    }

    return result;
}

/**
 * Compute Longest Common Subsequence between two arrays of strings
 */
interface LCSMatch {
    oldIndex: number;
    newIndex: number;
}

function computeLCS(oldLines: string[], newLines: string[]): LCSMatch[] {
    const m = oldLines.length;
    const n = newLines.length;

    // dp[i][j] = length of LCS for oldLines[0..i-1] and newLines[0..j-1]
    const dp: number[][] = Array(m + 1)
        .fill(null)
        .map(() => Array(n + 1).fill(0));

    // Fill DP table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find matches
    const matches: LCSMatch[] = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
        if (oldLines[i - 1] === newLines[j - 1]) {
            matches.unshift({ oldIndex: i - 1, newIndex: j - 1 });
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    return matches;
}
