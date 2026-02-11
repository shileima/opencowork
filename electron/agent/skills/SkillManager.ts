import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { app } from 'electron';
import { directoryManager } from '../../config/DirectoryManager';

export interface SkillDefinition {
    name: string;
    description: string;
    instructions: string;
    input_schema: Record<string, unknown>;
}

export class SkillManager {
    private static instance: SkillManager | null = null;

    /** 获取单例实例，避免多个 agent 重复加载 skills */
    static getInstance(): SkillManager {
        if (!SkillManager.instance) {
            SkillManager.instance = new SkillManager();
        }
        return SkillManager.instance;
    }

    private skillsDir: string;
    private skills: Map<string, SkillDefinition> = new Map();

    getSkillNames(): string[] {
        return Array.from(this.skills.keys());
    }

    getSkillMetadata(): { name: string; description: string }[] {
        return Array.from(this.skills.values()).map(s => ({
            name: s.name,
            description: s.description
        }));
    }

    constructor() {
        // 使用 DirectoryManager 获取技能目录
        this.skillsDir = directoryManager.getSkillsDir();
    }

    private async pathExists(testPath: string): Promise<boolean> {
        try {
            await fs.access(testPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取内置技能源目录
     * 优先使用热更新目录，否则使用内置资源
     */
    private async getBuiltinSkillsSourceDir(): Promise<string | null> {
        // 优先检查热更新目录
        const hotUpdateSkillsDir = directoryManager.getHotUpdateSkillsDir();
        if (await this.pathExists(hotUpdateSkillsDir)) {
            console.log('[SkillManager] Using hot-update skills directory');
            return hotUpdateSkillsDir;
        }

        // 回退到内置资源
        const builtinDir = directoryManager.getBuiltinSkillsDir();
        if (await this.pathExists(builtinDir)) {
            return builtinDir;
        }

        return null;
    }

    async initializeDefaults() {
        console.log('[SkillManager] Initializing default skills...');
        console.log(`[SkillManager] App packaged: ${app.isPackaged}`);
        console.log(`[SkillManager] Resources path: ${app.isPackaged ? process.resourcesPath : 'N/A (dev mode)'}`);
        console.log(`[SkillManager] CWD: ${process.cwd()}`);
        console.log(`[SkillManager] process.resourcesPath exists: ${app.isPackaged ? await this.pathExists(process.resourcesPath) : 'N/A'}`);

        try {
            // 获取内置技能目录（优先热更新）
            const sourceDir = await this.getBuiltinSkillsSourceDir();
            
            if (!sourceDir) {
                console.error('[SkillManager] ❌ Could not find default skills directory');
                return;
            }
            
            console.log(`[SkillManager] Using builtin skills directory: ${sourceDir}`);

            // Ensure target directory exists
            try {
                await fs.access(this.skillsDir);
            } catch {
                console.log(`[SkillManager] Creating target skills directory: ${this.skillsDir}`);
                await fs.mkdir(this.skillsDir, { recursive: true });
            }

            // Copy files recursively (including awesome-claude-skills subdirectory)
            console.log('[SkillManager] Reading source directory...');
            const files = await fs.readdir(sourceDir);
            console.log(`[SkillManager] Found ${files.length} items in source directory`);

            let installedCount = 0;
            let skippedCount = 0;

            // Helper function to recursively copy skills
            // Skills are flattened to the target directory (no nested structure)
            const copySkillsRecursively = async (sourcePath: string, baseTargetPath: string) => {
                const items = await fs.readdir(sourcePath);
                
                for (const item of items) {
                    const itemSourcePath = path.join(sourcePath, item);
                    let itemStats;
                    try {
                        itemStats = await fs.stat(itemSourcePath);
                    } catch {
                        console.log(`[SkillManager] Skipping inaccessible item: ${item}`);
                        continue;
                    }
                    
                    if (itemStats.isDirectory()) {
                        // Check if this directory contains a SKILL.md (it's a skill)
                        const skillMdPath = path.join(itemSourcePath, 'SKILL.md');
                        try {
                            await fs.access(skillMdPath);
                            // This is a skill directory - copy it to target (flattened)
                            const targetSkillPath = path.join(baseTargetPath, item);
                            
                            // Check if skill already exists
                            try {
                                await fs.access(targetSkillPath);
                                // 静默跳过已存在的 skill（减少日志噪音）
                                skippedCount++;
                            } catch {
                                // Doesn't exist, proceed to copy
                                try {
                                    await fs.cp(itemSourcePath, targetSkillPath, { recursive: true });
                                    console.log(`[SkillManager] ✓ Installed default skill: ${item}`);
                                    installedCount++;
                                } catch (e: any) {
                                    console.error(`[SkillManager] ✗ Failed to install skill ${item}:`, e.message);
                                }
                            }
                        } catch {
                            // No SKILL.md, might be a container directory (like awesome-claude-skills)
                            // Recursively process subdirectories
                            await copySkillsRecursively(itemSourcePath, baseTargetPath);
                        }
                    }
                }
            };

            // Process all skills recursively
            await copySkillsRecursively(sourceDir, this.skillsDir);

            console.log(`[SkillManager] ✅ Default skills initialization complete: ${installedCount} installed, ${skippedCount} skipped.`);
        } catch (e) {
            console.error('[SkillManager] ❌ Failed to initialize default skills:', e);
        }
    }

    private isLoading = false;
    private lastLoaded = 0;
    private readonly LOAD_COOLDOWN = 60000; // Increase cache to 60 seconds
    private defaultsInitialized = false;

    async loadSkills(force = false) {
        if (this.isLoading) {
            console.log('[SkillManager] Already loading skills, skipping concurrent request.');
            return;
        }

        // Skip if loaded recently (unless forced)
        if (!force && Date.now() - this.lastLoaded < this.LOAD_COOLDOWN) {
            console.log('[SkillManager] Skills loaded recently (cache hit), skipping reload.');
            return;
        }

        this.isLoading = true;
        console.log('[SkillManager] Starting loadSkills...');

        try {
            // Only initialize defaults ONCE per app session or if forced
            if (!this.defaultsInitialized || force) {
                // Wrap initializeDefaults in a timeout to prevent hanging
                const defaultsTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Defaults init timeout')), 5000));
                try {
                    await Promise.race([this.initializeDefaults(), defaultsTimeout]);
                    this.defaultsInitialized = true;
                } catch (e: any) {
                    console.error(`[SkillManager] Defaults initialization warning: ${e.message}`);
                }
            }

            console.log('[SkillManager] Clearing existing skills...');
            this.skills.clear();
            try {
                await fs.access(this.skillsDir);
            } catch {
                console.log('[SkillManager] No skills directory found, skipping load.');
                return; // No skills directory
            }

            console.log(`[SkillManager] Reading skills directory: ${this.skillsDir}`);
            const files = await fs.readdir(this.skillsDir);
            console.log(`[SkillManager] Found ${files.length} files/folders, loading...`);

            let loadedCount = 0;
            let failedCount = 0;

            for (const file of files) {
                // console.log(`[SkillManager] Checking file: ${file}`); // Reduced verbosity
                const filePath = path.join(this.skillsDir, file);
                let stats;
                try {
                    stats = await fs.stat(filePath);
                } catch { continue; }

                if (stats.isDirectory()) {
                    // Look for SKILL.md inside directory
                    const skillMdPath = path.join(filePath, 'SKILL.md');
                    try {
                        await fs.access(skillMdPath);
                        // 静默加载（减少日志噪音）
                        await this.parseSkill(skillMdPath);
                        loadedCount++;
                    } catch (e: any) {
                        // 静默跳过无效的 skill 目录
                        failedCount++;
                    }
                } else if (file.endsWith('.md')) {
                    // Support legacy single-file skills
                    try {
                        await this.parseSkill(filePath);
                        loadedCount++;
                    } catch (e: any) {
                        failedCount++;
                    }
                }
            }
            this.lastLoaded = Date.now();
            console.log(`[SkillManager] ✓ Loaded ${this.skills.size} skills (${loadedCount} processed, ${failedCount} skipped)`);
        } finally {
            this.isLoading = false;
        }
    }

    private async parseSkill(filePath: string) {
        try {
            // 静默读取（减少日志噪音）
            const content = await fs.readFile(filePath, 'utf-8');
            const parts = content.split('---');
            if (parts.length < 3) {
                console.warn(`[SkillManager] Invalid frontmatter structure in ${filePath}`);
                return;
            }

            const frontmatter = yaml.load(parts[1]) as { name?: string; description?: string; input_schema?: Record<string, unknown> } | undefined;
            const instructions = parts.slice(2).join('---').trim();

            if (frontmatter && frontmatter.name && frontmatter.description) {
                // Sanitize name for API usage
                const originalName = frontmatter.name;
                const sanitizedName = this.sanitizeName(originalName);

                if (sanitizedName !== originalName) {
                    console.log(`[SkillManager] Sanitized skill name: "${originalName}" -> "${sanitizedName}"`);
                }

                // 静默加载成功（减少日志噪音）

                // Key map by sanitized name so the AgentRuntime can find it exactly as the model calls it
                this.skills.set(sanitizedName, {
                    name: sanitizedName, // This is what the model sees
                    description: frontmatter.description,
                    input_schema: frontmatter.input_schema || { type: 'object', properties: {} },
                    instructions: instructions
                });
            } else {
                console.warn(`[SkillManager] Missing name/description in frontmatter of ${filePath}`);
            }
        } catch (e) {
            console.error(`[SkillManager] Failed to load skill from ${filePath}`, e);
        }
    }

    getTools() {
        return Array.from(this.skills.values()).map(skill => ({
            name: skill.name,
            description: skill.description,
            input_schema: skill.input_schema
        }));
    }

    getSkillInstructions(name: string): string | undefined {
        return this.getSkillInfo(name)?.instructions;
    }

    getSkillInfo(name: string): { instructions: string, skillDir: string } | undefined {
        // Try exact match first
        let skill = this.skills.get(name);
        let skillName = name;

        // Try underscore/hyphen swap if not found
        if (!skill) {
            const alternativeName = name.includes('_') ? name.replace(/_/g, '-') : name.replace(/-/g, '_');
            skill = this.skills.get(alternativeName);
            if (skill) skillName = alternativeName;
        }

        if (!skill) return undefined;

        // Return both instructions and the skill directory path
        const skillDir = path.join(this.skillsDir, skillName);
        return {
            instructions: skill.instructions,
            skillDir: skillDir
        };
    }


    /**
     * Sanitize skill name to comply with ^[a-zA-Z0-9_-]+$
     */
    private sanitizeName(name: string): string {
        // 1. Replace invalid chars with underscore
        let clean = name.replace(/[^a-zA-Z0-9_-]/g, '_');

        // 2. Remove duplicate underscores
        clean = clean.replace(/_+/g, '_');

        // 3. Remove leading/trailing underscores
        clean = clean.replace(/^_+|_+$/g, '');

        // 4. Fallback if empty
        if (!clean) {
            const hash = name.split('').reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0);
            return `skill_${Math.abs(hash).toString(16)}`;
        }

        return clean;
    }
}
