/**
 * 文件追踪系统类型定义
 * File Tracker Type Definitions
 */

// ============================================================
// 文件变更类型
// ============================================================

export type FileChangeType = 'created' | 'modified' | 'deleted';

export interface FileChange {
    id: string;                      // 唯一标识
    path: string;                    // 文件路径
    type: FileChangeType;           // 变更类型
    timestamp: number;              // 变更时间戳
    size?: number;                  // 文件大小
    oldContent?: string;            // 修改前的内容
    newContent?: string;            // 修改后的内容
    sessionId: string;              // 关联的会话ID
    messageId?: string;             // 关联的消息ID
    toolUseId?: string;             // 关联的工具调用ID
}

// ============================================================
// 文件快照类型
// ============================================================

export interface FileSnapshot {
    path: string;
    content: string;
    timestamp: number;
    hash: string;                    // 内容哈希（用于快速对比）
    size: number;
}

// ============================================================
// 文件树类型
// ============================================================

export interface FileTreeNode {
    id: string;                     // 唯一标识
    name: string;                   // 文件/目录名
    path: string;                   // 完整路径
    type: 'file' | 'directory';
    extension?: string;             // 文件扩展名
    size?: number;                  // 文件大小
    modified?: Date;                // 修改时间
    children?: FileTreeNode[];      // 子节点
    changes?: FileChange[];         // 变更记录
    expanded?: boolean;             // 是否展开
    hasChanges?: boolean;           // 是否有变更
}

// ============================================================
// 目录树类型
// ============================================================

export interface DirectoryTree {
    root: FileTreeNode;
    stats: {
        totalFiles: number;
        totalDirs: number;
        totalSize: number;
        changedFiles: number;
    };
}

// ============================================================
// 文件预览类型
// ============================================================

export type FilePreviewMode = 'source' | 'preview' | 'split';

export interface FilePreviewOptions {
    mode: FilePreviewMode;
    lineNumbers?: boolean;
    wrapLines?: boolean;
    highlightSyntax?: boolean;
}

// ============================================================
// 差异类型
// ============================================================

export interface DiffChange {
    type: 'added' | 'removed' | 'unchanged';
    lineNumber: number;
    content: string;
    oldLineNumber?: number;
    newLineNumber?: number;
}

export interface FileDiff {
    path: string;
    oldContent: string | null;
    newContent: string | null;
    changes: DiffChange[];
    summary: {
        additions: number;
        deletions: number;
        modifications: number;
    };
}

// ============================================================
// 搜索结果类型
// ============================================================

export interface SearchResult {
    path: string;
    name: string;
    type: 'file' | 'directory';
    matches: SearchMatch[];
}

export interface SearchMatch {
    line: number;
    column: number;
    length: number;
    text: string;
    context: string;
}

// ============================================================
// 文件操作类型
// ============================================================

export interface FileOperation {
    id: string;
    type: 'read' | 'write' | 'delete' | 'rename' | 'copy';
    path: string;
    timestamp: number;
    status: 'pending' | 'success' | 'failed';
    error?: string;
}

// ============================================================
// 会话文件关联类型
// ============================================================

export interface SessionFileMap {
    sessionId: string;
    files: string[];                // 涉及的文件路径列表
    changes: FileChange[];          // 所有变更
    rootPath: string;               // 工作目录根路径
}

// ============================================================
// 画布状态类型
// ============================================================

export interface FileCanvasState {
    isOpen: boolean;                // 画布是否打开
    width: number;                  // 画布宽度（像素）
    selectedPath: string | null;    // 当前选中文件
    expandedPaths: Set<string>;    // 展开的路径
    changes: Map<string, FileChange[]>; // 文件变更映射
    currentPreviewMode: FilePreviewMode;
}

// ============================================================
// 文件统计类型
// ============================================================

export interface FileStatistics {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    createdFiles: number;
    modifiedFiles: number;
    deletedFiles: number;
    largestFile: {
        path: string;
        size: number;
    };
    mostChangedFile: {
        path: string;
        changes: number;
    };
}
