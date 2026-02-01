import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export interface ProjectTask {
    id: string;
    title: string;
    sessionId: string; // 关联的 session ID
    createdAt: number;
    updatedAt: number;
    status: 'active' | 'completed' | 'failed';
}

export interface Project {
    id: string;
    name: string;
    path: string; // 项目目录路径
    createdAt: number;
    updatedAt: number;
    tasks: ProjectTask[];
}

interface ProjectStoreSchema {
    projects: Project[];
    currentProjectId: string | null;
}

const defaults: ProjectStoreSchema = {
    projects: [],
    currentProjectId: null
};

class ProjectStore {
    private store: Store<ProjectStoreSchema>;

    constructor() {
        this.store = new Store<ProjectStoreSchema>({
            name: 'qa-cowork-projects',
            defaults
        });
    }

    // Get all projects
    getProjects(): Project[] {
        return this.store.get('projects') || [];
    }

    // Get project by ID
    getProject(id: string): Project | null {
        const projects = this.store.get('projects') || [];
        return projects.find(p => p.id === id) || null;
    }

    // Get project by path (normalized for comparison)
    getProjectByPath(dirPath: string): Project | null {
        const normalized = dirPath.replace(/\/$/, '');
        const projects = this.store.get('projects') || [];
        return projects.find(p => p.path.replace(/\/$/, '') === normalized) || null;
    }

    // Get current project
    getCurrentProject(): Project | null {
        const currentId = this.store.get('currentProjectId');
        if (!currentId) return null;
        return this.getProject(currentId);
    }

    // Create new project
    createProject(name: string, path: string): Project {
        const project: Project = {
            id: uuidv4(),
            name,
            path,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tasks: []
        };

        const projects = this.store.get('projects') || [];
        projects.push(project);
        this.store.set('projects', projects);
        this.store.set('currentProjectId', project.id);

        return project;
    }

    // Open project (set as current)
    openProject(id: string): boolean {
        const project = this.getProject(id);
        if (!project) return false;
        this.store.set('currentProjectId', id);
        return true;
    }

    // Update project
    updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>): boolean {
        const projects = this.store.get('projects') || [];
        const index = projects.findIndex(p => p.id === id);
        if (index === -1) return false;

        projects[index] = {
            ...projects[index],
            ...updates,
            updatedAt: Date.now()
        };
        this.store.set('projects', projects);
        return true;
    }

    // Delete project
    deleteProject(id: string): boolean {
        const projects = this.store.get('projects') || [];
        const filtered = projects.filter(p => p.id !== id);
        if (filtered.length === projects.length) return false;

        this.store.set('projects', filtered);

        // If deleted project was current, clear current
        if (this.store.get('currentProjectId') === id) {
            this.store.set('currentProjectId', null);
        }

        return true;
    }

    // Create task in project
    createTask(projectId: string, title: string, sessionId: string): ProjectTask | null {
        const project = this.getProject(projectId);
        if (!project) return null;

        const task: ProjectTask = {
            id: uuidv4(),
            title,
            sessionId,
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

    // Get tasks for project
    getTasks(projectId: string): ProjectTask[] {
        const project = this.getProject(projectId);
        return project?.tasks || [];
    }

    // Update task
    updateTask(projectId: string, taskId: string, updates: Partial<Omit<ProjectTask, 'id'>>): boolean {
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

    // Delete task
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
}

export const projectStore = new ProjectStore();
