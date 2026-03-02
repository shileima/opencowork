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
            name: 'qa-cowork-scripts',
            defaults
        });
        // 使用 DirectoryManager 获取目录路径
        this.scriptsDir = directoryManager.getScriptsDir();
        // 官方脚本目录（资源目录）
        this.officialScriptsDir = this.getOfficialScriptsDir();
    }

    // 获取官方脚本目录路径
    private getOfficialScriptsDir(): string {
        // 使用 DirectoryManager 获取内置技能目录，然后拼接 chrome-agent 子目录
        return path.join(directoryManager.getBuiltinSkillsDir(), 'chrome-agent');
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
        // 支持多种匹配方式：精确匹配、文件名匹配、忽略大小写
        const normalizedScriptName = scriptName.toLowerCase();
        return manifest.officialScripts.some(s => {
            const normalizedManifestName = s.name.toLowerCase();
            const normalizedManifestFile = s.file.toLowerCase();
            return normalizedManifestName === normalizedScriptName || 
                   normalizedManifestFile === `${normalizedScriptName}.js` ||
                   normalizedManifestFile === normalizedScriptName;
        });
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
                const isOfficial = this.isOfficialScript(scriptName) ||
                                   this.isOfficialScript(dirent.name.replace('.js', ''));

                if (existing) {
                    existing.updatedAt = stats.mtimeMs;
                    existing.isOfficial = isOfficial;
                    existing.filePath = filePath;
                    results.push(existing);
                } else {
                    const newScript: Script = {
                        id: uuidv4(),
                        name: scriptName,
                        filePath,
                        createdAt: stats.birthtimeMs || Date.now(),
                        updatedAt: stats.mtimeMs,
                        isOfficial,
                    };
                    results.push(newScript);
                    console.log(`[ScriptStore] Found new script: ${scriptName} (${filePath})`);
                }
            } catch (error: any) {
                console.error(`[ScriptStore] Error processing file ${dirent.name}:`, error.message);
            }
        });
    }

    // 扫描目录并同步脚本列表（递归扫描 scripts/<sessionId>/ 子文件夹）
    syncScriptsFromDirectory(): Script[] {
        // 先同步官方脚本
        this.syncOfficialScripts();
        
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
            
            // 按更新时间排序（最新的在前），官方脚本优先
            validScripts.sort((a, b) => {
                if (a.isOfficial && !b.isOfficial) return -1;
                if (!a.isOfficial && b.isOfficial) return 1;
                return b.updatedAt - a.updatedAt;
            });
            
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

    // 标记脚本为官方
    markAsOfficial(id: string): boolean {
        const scripts = this.store.get('scripts') || [];
        const script = scripts.find(s => s.id === id);
        
        if (!script) {
            console.warn(`[ScriptStore] Script not found: ${id}`);
            return false;
        }

        // 如果已经是官方脚本，直接返回
        if (script.isOfficial) {
            return true;
        }

        try {
            // 读取脚本文件内容
            if (!fs.existsSync(script.filePath)) {
                console.error(`[ScriptStore] Script file not found: ${script.filePath}`);
                return false;
            }

            const scriptContent = fs.readFileSync(script.filePath, 'utf-8');
            const scriptFileName = path.basename(script.filePath);

            // 确保官方脚本目录存在
            if (!fs.existsSync(this.officialScriptsDir)) {
                fs.mkdirSync(this.officialScriptsDir, { recursive: true });
            }

            // 复制脚本文件到官方脚本目录
            const officialScriptPath = path.join(this.officialScriptsDir, scriptFileName);
            fs.writeFileSync(officialScriptPath, scriptContent, 'utf-8');
            console.log(`[ScriptStore] Copied script to official directory: ${officialScriptPath}`);

            // 更新官方脚本清单
            const manifest = this.loadOfficialScriptsManifest();
            if (!manifest) {
                // 如果清单不存在，创建新的
                const newManifest: OfficialScriptManifest = {
                    version: '1.0.0',
                    officialScripts: [{
                        name: script.name,
                        file: scriptFileName,
                        description: `官方脚本: ${script.name}`,
                        version: '1.0.0'
                    }]
                };
                const manifestPath = path.join(this.officialScriptsDir, 'official-scripts.json');
                fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2), 'utf-8');
                this.officialScriptsManifest = newManifest;
            } else {
                // 检查是否已存在
                const exists = manifest.officialScripts.some(s => s.name === script.name || s.file === scriptFileName);
                if (!exists) {
                    manifest.officialScripts.push({
                        name: script.name,
                        file: scriptFileName,
                        description: `官方脚本: ${script.name}`,
                        version: '1.0.0'
                    });
                    const manifestPath = path.join(this.officialScriptsDir, 'official-scripts.json');
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
                    this.officialScriptsManifest = manifest;
                }
            }

            // 同步到用户目录（确保用户也能看到官方脚本）
            this.syncOfficialScripts();

            // 更新脚本记录
            script.isOfficial = true;
            script.updatedAt = Date.now();
            this.store.set('scripts', scripts);

            console.log(`[ScriptStore] Marked script as official: ${script.name}`);
            return true;
        } catch (error) {
            console.error(`[ScriptStore] Error marking script as official:`, error);
            return false;
        }
    }

    // 将官方脚本标记为非官方（仅管理员）
    unmarkAsOfficial(id: string): boolean {
        const scripts = this.store.get('scripts') || [];
        const script = scripts.find(s => s.id === id);
        
        if (!script) {
            console.warn(`[ScriptStore] Script not found: ${id}`);
            return false;
        }

        // 如果不是官方脚本，直接返回
        if (!script.isOfficial) {
            return true;
        }

        try {
            const scriptFileName = path.basename(script.filePath);

            // 从官方脚本清单中移除
            const manifest = this.loadOfficialScriptsManifest();
            if (manifest) {
                const normalizedScriptName = script.name.toLowerCase();
                const normalizedFileName = scriptFileName.toLowerCase();
                
                manifest.officialScripts = manifest.officialScripts.filter(s => {
                    const normalizedManifestName = s.name.toLowerCase();
                    const normalizedManifestFile = s.file.toLowerCase();
                    return normalizedManifestName !== normalizedScriptName && 
                           normalizedManifestFile !== normalizedFileName &&
                           normalizedManifestFile !== `${normalizedScriptName}.js`;
                });

                const manifestPath = path.join(this.officialScriptsDir, 'official-scripts.json');
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
                this.officialScriptsManifest = manifest;
                console.log(`[ScriptStore] Removed script from official manifest: ${script.name}`);
            }

            // 更新脚本记录（标记为非官方）
            script.isOfficial = false;
            script.updatedAt = Date.now();
            this.store.set('scripts', scripts);

            console.log(`[ScriptStore] Unmarked script as official: ${script.name}`);
            return true;
        } catch (error) {
            console.error(`[ScriptStore] Error unmarking script as official:`, error);
            return false;
        }
    }
}

export const scriptStore = new ScriptStore();
