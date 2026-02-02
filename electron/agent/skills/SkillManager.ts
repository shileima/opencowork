import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import os from 'os';
import { app } from 'electron';
import logger from '../../services/Logger';

export interface SkillDefinition {
    name: string;
    description: string;
    instructions: string;
    input_schema: Record<string, unknown>;
}

export class SkillManager {
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
        this.skillsDir = path.join(os.homedir(), '.opencowork', 'skills');
    }

    private async pathExists(testPath: string): Promise<boolean> {
        try {
            await fs.access(testPath);
            return true;
        } catch {
            return false;
        }
    }

    async initializeDefaults() {
        logger.debug('[SkillManager] Initializing default skills...');
        logger.debug(`App packaged: ${app.isPackaged}`);
        logger.debug(`Resources path: ${app.isPackaged ? process.resourcesPath : 'N/A (dev mode)'}`);
        logger.debug(`CWD: ${process.cwd()}`);
        logger.debug(`process.resourcesPath exists: ${app.isPackaged ? await this.pathExists(process.resourcesPath) : 'N/A'}`);

        try {
            // Determine source directory for default skills
            let sourceDir = '';
            const possiblePaths: string[] = [];

            if (app.isPackaged) {
                // In production, try multiple possible locations
                possiblePaths.push(
                    path.join(process.resourcesPath, 'skills'),  // Our electron-builder config
                    path.join(process.resourcesPath, 'resources', 'skills'),  // Alternative layout
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'skills')  // Unpacked asar
                );
            } else {
                // In development
                possiblePaths.push(
                    path.join(process.cwd(), 'resources', 'skills'),
                    path.join(process.cwd(), 'skills')  // Alternative dev layout
                );
            }

            // Try each possible path
            for (const testPath of possiblePaths) {
                logger.debug(`Checking path: ${testPath}`);
                try {
                    await fs.access(testPath);
                    sourceDir = testPath;
                    logger.debug(`✓ Found skills directory at: ${testPath}`);
                    break;
                } catch {
                    logger.debug(`✗ Path not found: ${testPath}`);
                }
            }

            if (!sourceDir) {
                logger.error('[SkillManager] ❌ Could not find default skills directory in any of these locations:', possiblePaths);
                return;
            }

            logger.debug(`Using source directory: ${sourceDir}`);

            // Ensure target directory exists
            try {
                await fs.access(this.skillsDir);
            } catch {
                logger.debug(`Creating target skills directory: ${this.skillsDir}`);
                await fs.mkdir(this.skillsDir, { recursive: true });
            }

            // Copy files
            logger.debug('[SkillManager] Reading source directory...');
            const files = await fs.readdir(sourceDir);
            logger.debug(`Found ${files.length} items in source directory`);

            let installedCount = 0;
            let skippedCount = 0;

            for (const file of files) {
                // Must be a directory (skills are folders now)
                try {
                    const stats = await fs.stat(path.join(sourceDir, file));
                    if (!stats.isDirectory()) {
                        logger.debug(`Skipping non-directory item: ${file}`);
                        continue;
                    }
                } catch {
                    logger.debug(`Skipping inaccessible item: ${file}`);
                    continue;
                }

                const targetPath = path.join(this.skillsDir, file);

                // Check if skill already exists to avoid re-copying on every startup
                try {
                    await fs.access(targetPath);
                    // Exists, skip
                    logger.debug(`⊙ Skipped existing skill: ${file}`);
                    skippedCount++;
                } catch {
                    // Doesn't exist, proceed to copy
                    try {
                        await fs.cp(path.join(sourceDir, file), targetPath, { recursive: true });
                        logger.debug(`✓ Installed default skill: ${file}`);
                        installedCount++;
                    } catch (e) {
                        logger.error(`✗ Failed to install skill ${file}:`, e);
                    }
                }
            }

            logger.debug(`✅ Default skills initialization complete: ${installedCount} installed, ${skippedCount} skipped.`);
        } catch (e) {
            logger.error('[SkillManager] ❌ Failed to initialize default skills:', e);
        }
    }

    private isLoading = false;
    private lastLoaded = 0;
    private readonly LOAD_COOLDOWN = 60000; // Increase cache to 60 seconds
    private defaultsInitialized = false;

    async loadSkills(force = false) {
        if (this.isLoading) {
            logger.debug('[SkillManager] Already loading skills, skipping concurrent request.');
            return;
        }

        // Skip if loaded recently (unless forced)
        if (!force && Date.now() - this.lastLoaded < this.LOAD_COOLDOWN) {
            logger.debug('[SkillManager] Skills loaded recently (cache hit), skipping reload.');
            return;
        }

        this.isLoading = true;
        logger.debug('[SkillManager] Starting loadSkills...');

        try {
            // Only initialize defaults ONCE per app session or if forced
            if (!this.defaultsInitialized || force) {
                // Wrap initializeDefaults in a timeout to prevent hanging
                const defaultsTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Defaults init timeout')), 5000));
                try {
                    await Promise.race([this.initializeDefaults(), defaultsTimeout]);
                    this.defaultsInitialized = true;
                } catch (e: any) {
                    logger.error(`Defaults initialization warning: ${e.message}`);
                }
            }

            logger.debug('[SkillManager] Clearing existing skills...');
            this.skills.clear();
            try {
                await fs.access(this.skillsDir);
            } catch {
                logger.debug('[SkillManager] No skills directory found, skipping load.');
                return; // No skills directory
            }

            logger.debug(`Reading skills directory: ${this.skillsDir}`);
            const files = await fs.readdir(this.skillsDir);
            logger.debug(`Found ${files.length} files/folders.`);

            for (const file of files) {
                // logger.debug(`Checking file: ${file}`); // Reduced verbosity
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
                        logger.debug(`Parsing skill (directory): ${file}`);
                        await this.parseSkill(skillMdPath);
                    } catch {
                        // logger.debug(`No SKILL.md found in ${file}`);
                    }
                } else if (file.endsWith('.md')) {
                    // Support legacy single-file skills
                    logger.debug(`Parsing skill (file): ${file}`);
                    await this.parseSkill(filePath);
                }
            }
            this.lastLoaded = Date.now();
            logger.debug(`Loaded ${this.skills.size} skills total.`);
        } finally {
            this.isLoading = false;
        }
    }

    private async parseSkill(filePath: string) {
        try {
            logger.debug(`Reading content of ${filePath}`);
            const content = await fs.readFile(filePath, 'utf-8');
            const parts = content.split('---');
            if (parts.length < 3) {
                logger.warn(`Invalid frontmatter structure in ${filePath}`);
                return;
            }

            const frontmatter = yaml.load(parts[1]) as { name?: string; description?: string; input_schema?: Record<string, unknown> } | undefined;
            const instructions = parts.slice(2).join('---').trim();

            if (frontmatter && frontmatter.name && frontmatter.description) {
                // Sanitize name for API usage
                const originalName = frontmatter.name;
                const sanitizedName = this.sanitizeName(originalName);

                if (sanitizedName !== originalName) {
                    logger.debug(`Sanitized skill name: "${originalName}" -> "${sanitizedName}"`);
                }

                logger.debug(`Successfully loaded ${sanitizedName}`);

                // Key map by sanitized name so the AgentRuntime can find it exactly as the model calls it
                this.skills.set(sanitizedName, {
                    name: sanitizedName, // This is what the model sees
                    description: frontmatter.description,
                    input_schema: frontmatter.input_schema || { type: 'object', properties: {} },
                    instructions: instructions
                });
            } else {
                logger.warn(`Missing name/description in frontmatter of ${filePath}`);
            }
        } catch (e) {
            logger.error(`Failed to load skill from ${filePath}`, e);
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
