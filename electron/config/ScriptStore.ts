import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface Script {
    id: string;
    name: string;
    filePath: string;
    createdAt: number;
    updatedAt: number;
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
            name: 'opencowork-scripts',
            defaults
        });
        // chrome-agent 脚本目录
        this.scriptsDir = path.join(os.homedir(), '.opencowork', 'skills', 'chrome-agent');
    }

    // 扫描目录并同步脚本列表
    syncScriptsFromDirectory(): Script[] {
        const scripts: Script[] = [];
        
        if (!fs.existsSync(this.scriptsDir)) {
            console.log(`[ScriptStore] Directory does not exist: ${this.scriptsDir}`);
            return scripts;
        }

        try {
            const files = fs.readdirSync(this.scriptsDir);
            const existingScripts = this.store.get('scripts') || [];
            
            files.forEach(file => {
                if (file.endsWith('.js')) {
                    const filePath = path.join(this.scriptsDir, file);
                    
                    // 跳过不存在的文件（可能已被删除）
                    if (!fs.existsSync(filePath)) {
                        return;
                    }
                    
                    const stats = fs.statSync(filePath);
                    const scriptName = path.basename(file, '.js');
                    
                    // 检查是否已存在
                    const existing = existingScripts.find(s => s.filePath === filePath);
                    
                    if (existing) {
                        // 更新修改时间
                        existing.updatedAt = stats.mtimeMs;
                        scripts.push(existing);
                    } else {
                        // 创建新脚本记录
                        scripts.push({
                            id: uuidv4(),
                            name: scriptName,
                            filePath: filePath,
                            createdAt: stats.birthtimeMs || Date.now(),
                            updatedAt: stats.mtimeMs
                        });
                    }
                }
            });
            
            // 清理已不存在的脚本记录
            const validScripts = scripts.filter(s => fs.existsSync(s.filePath));
            
            // 按更新时间排序（最新的在前）
            validScripts.sort((a, b) => b.updatedAt - a.updatedAt);
            
            // 保存到 store
            this.store.set('scripts', validScripts);
            
            console.log(`[ScriptStore] Synced ${validScripts.length} scripts from ${this.scriptsDir}`);
            return validScripts;
        } catch (error) {
            console.error(`[ScriptStore] Error syncing scripts:`, error);
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
}

export const scriptStore = new ScriptStore();
