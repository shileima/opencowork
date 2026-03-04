import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { directoryManager } from './DirectoryManager';

export interface Script {
    id: string;
    name: string;
    filePath: string;
    createdAt: number;
    updatedAt: number;
    isOfficial?: boolean; // 是否为官方脚本
}

interface ScriptStoreSchema {
    scripts: Script[];
}

const defaults: ScriptStoreSchema = {
    scripts: []
};

class ScriptStore {
    private store: Store<ScriptStoreSchema>;
    private readonly scriptsDir: string;

    constructor() {
        this.store = new Store<ScriptStoreSchema>({
            name: 'qa-cowork-scripts',
            defaults
        });
        this.scriptsDir = directoryManager.getScriptsDir();
    }

    // 规范化文件路径（用于比较）
    private normalizePath(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, '/');
    }

    /**
     * 递归收集目录下所有 .js 脚本文件
     * scripts/ 下按 <sessionId>/ 子文件夹组织，每个子文件夹对应一次聊天
     */
    private collectScriptFiles(
        dir: string,
        existingScripts: Array<Script & { normalizedPath: string }>,
        results: Script[]
    ): void {
        const excludedDirs = ['node_modules', '.git', 'session', 'fonts'];
        const excludedFiles = ['.gitignore', 'package.json', 'package-lock.json', 'requirements.txt'];

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        entries.forEach(dirent => {
            if (dirent.isDirectory()) {
                if (!excludedDirs.includes(dirent.name)) {
                    // 递归进入子文件夹（即 <sessionId>/ 目录）
                    this.collectScriptFiles(path.join(dir, dirent.name), existingScripts, results);
                }
                return;
            }

            if (excludedFiles.includes(dirent.name) || !dirent.name.endsWith('.js')) {
                return;
            }

            const filePath = path.join(dir, dirent.name);
            const normalizedPath = this.normalizePath(filePath);

            if (!fs.existsSync(filePath)) {
                console.warn(`[ScriptStore] File does not exist: ${filePath}`);
                return;
            }

            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) {
                    return;
                }

                const scriptName = path.basename(dirent.name, '.js');
                const existing = existingScripts.find(s => s.normalizedPath === normalizedPath);

                if (existing) {
                    existing.updatedAt = stats.mtimeMs;
                    existing.isOfficial = false;
                    existing.filePath = filePath;
                    results.push(existing);
                } else {
                    const newScript: Script = {
                        id: uuidv4(),
                        name: scriptName,
                        filePath,
                        createdAt: stats.birthtimeMs || Date.now(),
                        updatedAt: stats.mtimeMs,
                        isOfficial: false,
                    };
                    results.push(newScript);
                    console.log(`[ScriptStore] Found new script: ${scriptName} (${filePath})`);
                }
            } catch (error: any) {
                console.error(`[ScriptStore] Error processing file ${dirent.name}:`, error.message);
            }
        });
    }

    // 扫描目录并同步脚本列表（递归扫描 .qa-cowork/scripts/<sessionId>/ 子文件夹）
    syncScriptsFromDirectory(): Script[] {
        const scripts: Script[] = [];
        
        if (!fs.existsSync(this.scriptsDir)) {
            console.log(`[ScriptStore] Directory does not exist: ${this.scriptsDir}`);
            return scripts;
        }

        try {
            const existingScripts = this.store.get('scripts') || [];
            const normalizedExistingScripts = existingScripts.map(s => ({
                ...s,
                normalizedPath: this.normalizePath(s.filePath)
            }));

            this.collectScriptFiles(this.scriptsDir, normalizedExistingScripts, scripts);
            
            // 清理已不存在的脚本记录
            const validScripts = scripts.filter(s => {
                const exists = fs.existsSync(s.filePath);
                if (!exists) {
                    console.log(`[ScriptStore] Removing script that no longer exists: ${s.name} (${s.filePath})`);
                }
                return exists;
            });
            
            // 按更新时间排序（最新的在前）
            validScripts.sort((a, b) => b.updatedAt - a.updatedAt);
            
            this.store.set('scripts', validScripts);
            
            console.log(`[ScriptStore] Synced ${validScripts.length} scripts from ${this.scriptsDir}`);
            console.log(`[ScriptStore] Script names: ${validScripts.map(s => s.name).join(', ')}`);
            return validScripts;
        } catch (error: any) {
            console.error(`[ScriptStore] Error syncing scripts:`, error.message);
            console.error(`[ScriptStore] Error stack:`, error.stack);
            return [];
        }
    }

    // 获取所有脚本
    getScripts(): Script[] {
        // 先同步目录，确保最新
        return this.syncScriptsFromDirectory();
    }

    // 根据 ID 获取脚本
    getScript(id: string): Script | null {
        const scripts = this.store.get('scripts') || [];
        return scripts.find(s => s.id === id) || null;
    }

    // 删除脚本（同时删除文件和 store 记录）
    deleteScript(id: string): boolean {
        const scripts = this.store.get('scripts') || [];
        const script = scripts.find(s => s.id === id);
        
        if (!script) {
            console.warn(`[ScriptStore] Script not found: ${id}`);
            return false;
        }

        try {
            // 删除文件
            if (fs.existsSync(script.filePath)) {
                fs.unlinkSync(script.filePath);
                console.log(`[ScriptStore] Deleted file: ${script.filePath}`);
            }
            
            // 从 store 中删除
            const updatedScripts = scripts.filter(s => s.id !== id);
            this.store.set('scripts', updatedScripts);
            
            return true;
        } catch (error) {
            console.error(`[ScriptStore] Error deleting script:`, error);
            return false;
        }
    }

    // 手动添加脚本（如果文件不在目录中）
    addScript(name: string, filePath: string): Script {
        const script: Script = {
            id: uuidv4(),
            name: name,
            filePath: filePath,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        const scripts = this.store.get('scripts') || [];
        scripts.unshift(script);
        this.store.set('scripts', scripts);
        
        return script;
    }

    // 重命名脚本
    renameScript(id: string, newName: string): boolean {
        const scripts = this.store.get('scripts') || [];
        const script = scripts.find(s => s.id === id);
        
        if (!script) {
            console.warn(`[ScriptStore] Script not found: ${id}`);
            return false;
        }

        try {
            const oldFilePath = script.filePath;
            const oldDir = path.dirname(oldFilePath);
            const newFilePath = path.join(oldDir, `${newName}.js`);

            // 重命名文件
            if (fs.existsSync(oldFilePath)) {
                fs.renameSync(oldFilePath, newFilePath);
                console.log(`[ScriptStore] Renamed script file: ${oldFilePath} -> ${newFilePath}`);
            }

            // 更新 store 记录
            script.name = newName;
            script.filePath = newFilePath;
            script.updatedAt = Date.now();
            
            this.store.set('scripts', scripts);
            return true;
        } catch (error) {
            console.error(`[ScriptStore] Error renaming script:`, error);
            return false;
        }
    }
}

export const scriptStore = new ScriptStore();
