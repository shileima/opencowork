import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

export interface Script {
    id: string;
    name: string;
    filePath: string;
    createdAt: number;
    updatedAt: number;
    isOfficial?: boolean; // 是否为官方脚本
}

interface OfficialScriptManifest {
    version: string;
    officialScripts: Array<{
        name: string;
        file: string;
        description: string;
        version: string;
    }>;
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
    private readonly officialScriptsDir: string;
    private officialScriptsManifest: OfficialScriptManifest | null = null;

    constructor() {
        this.store = new Store<ScriptStoreSchema>({
            name: 'opencowork-scripts',
            defaults
        });
        // chrome-agent 脚本目录（用户目录）
        this.scriptsDir = path.join(os.homedir(), '.opencowork', 'skills', 'chrome-agent');
        // 官方脚本目录（资源目录）
        this.officialScriptsDir = this.getOfficialScriptsDir();
    }

    // 获取官方脚本目录路径
    private getOfficialScriptsDir(): string {
        const possiblePaths: string[] = [];

        if (app.isPackaged) {
            // 生产环境
            possiblePaths.push(
                path.join(process.resourcesPath, 'skills', 'chrome-agent'),
                path.join(process.resourcesPath, 'resources', 'skills', 'chrome-agent'),
                path.join(process.resourcesPath, 'app.asar.unpacked', 'skills', 'chrome-agent')
            );
        } else {
            // 开发环境
            possiblePaths.push(
                path.join(process.cwd(), 'resources', 'skills', 'chrome-agent')
            );
        }

        // 尝试找到存在的路径
        for (const testPath of possiblePaths) {
            if (fs.existsSync(testPath)) {
                return testPath;
            }
        }

        // 如果都不存在，返回第一个可能的路径（用于创建）
        return possiblePaths[0] || path.join(process.cwd(), 'resources', 'skills', 'chrome-agent');
    }

    // 读取官方脚本清单
    private loadOfficialScriptsManifest(): OfficialScriptManifest | null {
        if (this.officialScriptsManifest) {
            return this.officialScriptsManifest;
        }

        const manifestPath = path.join(this.officialScriptsDir, 'official-scripts.json');
        
        if (!fs.existsSync(manifestPath)) {
            console.log(`[ScriptStore] Official scripts manifest not found: ${manifestPath}`);
            return null;
        }

        try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            this.officialScriptsManifest = JSON.parse(content) as OfficialScriptManifest;
            console.log(`[ScriptStore] Loaded official scripts manifest: ${this.officialScriptsManifest.officialScripts.length} scripts`);
            return this.officialScriptsManifest;
        } catch (error) {
            console.error(`[ScriptStore] Error loading official scripts manifest:`, error);
            return null;
        }
    }

    // 判断脚本是否为官方脚本
    isOfficialScript(scriptName: string): boolean {
        const manifest = this.loadOfficialScriptsManifest();
        if (!manifest) {
            return false;
        }
        return manifest.officialScripts.some(s => s.name === scriptName || s.file === `${scriptName}.js`);
    }

    // 获取官方脚本列表
    getOfficialScripts(): Array<{ name: string; file: string; description: string; version: string }> {
        const manifest = this.loadOfficialScriptsManifest();
        return manifest?.officialScripts || [];
    }

    // 同步官方脚本到用户目录
    syncOfficialScripts(): void {
        const manifest = this.loadOfficialScriptsManifest();
        if (!manifest) {
            console.log('[ScriptStore] No official scripts manifest found, skipping sync');
            return;
        }

        // 确保用户脚本目录存在
        if (!fs.existsSync(this.scriptsDir)) {
            fs.mkdirSync(this.scriptsDir, { recursive: true });
            console.log(`[ScriptStore] Created user scripts directory: ${this.scriptsDir}`);
        }

        let syncedCount = 0;
        let skippedCount = 0;

        for (const officialScript of manifest.officialScripts) {
            const sourcePath = path.join(this.officialScriptsDir, officialScript.file);
            const targetPath = path.join(this.scriptsDir, officialScript.file);

            // 检查源文件是否存在
            if (!fs.existsSync(sourcePath)) {
                console.warn(`[ScriptStore] Official script not found: ${sourcePath}`);
                continue;
            }

            // 如果目标文件已存在，跳过（保留用户修改）
            if (fs.existsSync(targetPath)) {
                console.log(`[ScriptStore] Skipped existing script: ${officialScript.file} (preserving user version)`);
                skippedCount++;
                continue;
            }

            // 复制官方脚本到用户目录
            try {
                fs.copyFileSync(sourcePath, targetPath);
                console.log(`[ScriptStore] Synced official script: ${officialScript.file}`);
                syncedCount++;
            } catch (error) {
                console.error(`[ScriptStore] Error syncing official script ${officialScript.file}:`, error);
            }
        }

        console.log(`[ScriptStore] Official scripts sync complete: ${syncedCount} synced, ${skippedCount} skipped`);
    }

    // 扫描目录并同步脚本列表
    syncScriptsFromDirectory(): Script[] {
        // 先同步官方脚本
        this.syncOfficialScripts();
        
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
                    
                    // 判断是否为官方脚本
                    const isOfficial = this.isOfficialScript(scriptName);
                    
                    if (existing) {
                        // 更新修改时间和官方标记
                        existing.updatedAt = stats.mtimeMs;
                        existing.isOfficial = isOfficial;
                        scripts.push(existing);
                    } else {
                        // 创建新脚本记录
                        scripts.push({
                            id: uuidv4(),
                            name: scriptName,
                            filePath: filePath,
                            createdAt: stats.birthtimeMs || Date.now(),
                            updatedAt: stats.mtimeMs,
                            isOfficial: isOfficial
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

        // 官方脚本不允许删除
        if (script.isOfficial) {
            console.warn(`[ScriptStore] Cannot delete official script: ${script.name}`);
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
