import Store from 'electron-store';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';

export interface RPATask {
    id: string;
    title: string;
    sessionId: string;
    /** 关联的脚本文件名，如 script_xxx.js 或 script_xxx.py */
    scriptFileName?: string;
    /** 下次生成脚本的版本号，首次为 1，每次聊天生成后累加 */
    scriptVersion?: number;
    createdAt: number;
    updatedAt: number;
    status: 'active' | 'completed' | 'failed';
}

export interface RPAProject {
    id: string;
    name: string;
    path: string;
    /** 项目技能说明，用于指导 AI 生成自动化脚本 */
    skillDescription?: string;
    createdAt: number;
    updatedAt: number;
    tasks: RPATask[];
}

interface RPAProjectStoreSchema {
    projects: RPAProject[];
    currentProjectId: string | null;
}

function getDefaultRpaProjectsPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, 'Library', 'Application Support', 'qacowork', 'rpaProjects');
}

const defaults: RPAProjectStoreSchema = {
    projects: [],
    currentProjectId: null
};

class RPAProjectStore {
    private store: Store<RPAProjectStoreSchema>;

    constructor() {
        this.store = new Store<RPAProjectStoreSchema>({
            name: 'qa-cowork-rpa-projects',
            defaults
        });
    }

    getDefaultRpaPath(): string {
        return getDefaultRpaProjectsPath();
    }

    ensureRpaProjectsDir(): string {
        const dir = getDefaultRpaProjectsPath();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    getProjects(): RPAProject[] {
        return this.store.get('projects') || [];
    }

    getProject(id: string): RPAProject | null {
        const projects = this.store.get('projects') || [];
        return projects.find(p => p.id === id) || null;
    }

    getCurrentProject(): RPAProject | null {
        let project = this.getProjectById(this.store.get('currentProjectId'));
        if (!project) {
            project = this.ensureDefaultProject();
        }
        return project;
    }

    /** 切换当前项目 */
    setCurrentProject(id: string): boolean {
        const project = this.getProject(id);
        if (!project) return false;
        this.store.set('currentProjectId', id);
        return true;
    }

    /** 新建自动化项目 */
    createProject(name: string): RPAProject | null {
        const baseDir = this.ensureRpaProjectsDir();
        const sanitized = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/-+/g, '-') || 'rpa-project';
        let dirName = sanitized;
        let dirPath = path.join(baseDir, dirName);
        let n = 1;
        while (fs.existsSync(dirPath)) {
            dirName = `${sanitized}-${n}`;
            dirPath = path.join(baseDir, dirName);
            n += 1;
        }
        fs.mkdirSync(dirPath, { recursive: true });

        const project: RPAProject = {
            id: uuidv4(),
            name: name.trim() || dirName,
            path: dirPath,
            skillDescription: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tasks: []
        };

        // 在项目目录下创建 SKILL.md 技能说明模板
        const skillMdPath = path.join(dirPath, 'SKILL.md');
        const defaultSkillContent = `# ${name.trim() || dirName} - 自动化脚本说明

## 项目目标
描述本项目的自动化目标，例如：百度搜索新闻、表单填写、数据采集等。

## 技术约束
- 使用 Playwright 进行浏览器自动化（.js 或 .py）
- 脚本保存在本项目目录下，命名格式：\`<任务名>_v<版本号>.js\`（如 task_v1.js、task_v2.js）
- 首次生成为 _v1，每次聊天迭代累加 _v2、_v3...
- **脚本职责**：仅负责网页操作（导航、点击、填写、截图、提取数据并写入 JSON/HTML）。生成 PDF 或其它文件请使用 **generate-file** 技能或独立脚本，不写在自动化脚本内。

## 注意事项
- 仅使用 Playwright，禁止 Selenium、Puppeteer
- 保持浏览器打开以便验证（除非用户明确要求关闭）
`;
        fs.writeFileSync(skillMdPath, defaultSkillContent, 'utf-8');

        const projects = this.store.get('projects') || [];
        projects.push(project);
        this.store.set('projects', projects);
        this.store.set('currentProjectId', project.id);
        return project;
    }

    private getProjectById(id: string | null): RPAProject | null {
        if (!id) return null;
        return this.getProject(id);
    }

    private ensureDefaultProject(): RPAProject | null {
        const dir = this.ensureRpaProjectsDir();
        const projects = this.store.get('projects') || [];
        const existing = projects.find(p => p.path === dir);
        if (existing) {
            this.store.set('currentProjectId', existing.id);
            return existing;
        }
        const project: RPAProject = {
            id: uuidv4(),
            name: 'RPA 自动化',
            path: dir,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tasks: []
        };
        projects.push(project);
        this.store.set('projects', projects);
        this.store.set('currentProjectId', project.id);
        return project;
    }

    createTask(projectId: string, title: string, sessionId: string, scriptFileName?: string): RPATask | null {
        const project = this.getProject(projectId);
        if (!project) return null;

        const task: RPATask = {
            id: uuidv4(),
            title,
            sessionId,
            scriptFileName,
            scriptVersion: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active'
        };

        project.tasks.push(task);
        project.updatedAt = Date.now();

        const projects = this.store.get('projects') || [];
        const index = projects.findIndex(p => p.id === projectId);
        if (index !== -1) {
            projects[index] = project;
            this.store.set('projects', projects);
        }

        return task;
    }

    getTasks(projectId: string): RPATask[] {
        const project = this.getProject(projectId);
        return project?.tasks || [];
    }

    /** 获取任务下次生成脚本的版本号（不递增） */
    getNextScriptVersion(projectId: string, taskId: string): number {
        const project = this.getProject(projectId);
        if (!project) return 1;
        const task = project.tasks.find(t => t.id === taskId);
        return task?.scriptVersion ?? 1;
    }

    /** 脚本生成完成后递增版本号 */
    incrementScriptVersion(projectId: string, taskId: string): void {
        const v = this.getNextScriptVersion(projectId, taskId);
        this.updateTask(projectId, taskId, { scriptVersion: v + 1 });
    }

    updateProject(projectId: string, updates: Partial<Pick<RPAProject, 'name' | 'skillDescription'>>): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;
        Object.assign(project, updates, { updatedAt: Date.now() });
        const projects = this.store.get('projects') || [];
        const index = projects.findIndex(p => p.id === projectId);
        if (index !== -1) {
            projects[index] = project;
            this.store.set('projects', projects);
        }
        return true;
    }

    updateTask(projectId: string, taskId: string, updates: Partial<Omit<RPATask, 'id'>>): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;

        const taskIndex = project.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return false;

        project.tasks[taskIndex] = {
            ...project.tasks[taskIndex],
            ...updates,
            updatedAt: Date.now()
        };
        project.updatedAt = Date.now();

        const projects = this.store.get('projects') || [];
        const index = projects.findIndex(p => p.id === projectId);
        if (index !== -1) {
            projects[index] = project;
            this.store.set('projects', projects);
        }

        return true;
    }

    deleteTask(projectId: string, taskId: string): boolean {
        const project = this.getProject(projectId);
        if (!project) return false;

        const initialLength = project.tasks.length;
        project.tasks = project.tasks.filter(t => t.id !== taskId);
        if (project.tasks.length === initialLength) return false;

        project.updatedAt = Date.now();

        const projects = this.store.get('projects') || [];
        const index = projects.findIndex(p => p.id === projectId);
        if (index !== -1) {
            projects[index] = project;
            this.store.set('projects', projects);
        }

        return true;
    }

    /** 删除项目，返回是否成功及切换后的项目 ID */
    deleteProject(id: string): { success: boolean; switchedToProjectId?: string } {
        const projects = this.store.get('projects') || [];
        const filtered = projects.filter(p => p.id !== id);
        if (filtered.length === projects.length) {
            return { success: false };
        }

        this.store.set('projects', filtered);

        let switchedToProjectId: string | undefined;

        if (this.store.get('currentProjectId') === id) {
            if (filtered.length > 0) {
                const sorted = [...filtered].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
                const next = sorted[0];
                this.store.set('currentProjectId', next.id);
                switchedToProjectId = next.id;
            } else {
                this.store.set('currentProjectId', null);
            }
        }

        return { success: true, switchedToProjectId };
    }
}

export const rpaProjectStore = new RPAProjectStore();
