import { configStore } from './ConfigStore';
import { directoryManager } from './DirectoryManager';
import os from 'os';
import fs from 'fs';
import path from 'path';

export type UserRole = 'user' | 'admin';

/**
 * 预设管理员配置接口
 */
export interface AdminUsersConfig {
    version: string;
    adminUsers: string[]; // 系统用户名列表
    adminEmails?: string[]; // 邮箱列表（可选）
    adminMacAddresses?: string[]; // MAC地址列表（可选）
}

/**
 * PermissionService - 权限管理服务
 * 
 * 提供用户角色管理和权限检查功能
 * 支持预设管理员机制：通过配置文件预设管理员用户
 */
export class PermissionService {
    private static instance: PermissionService;
    private adminUsersConfig: AdminUsersConfig | null = null;
    private currentUserIdentifier: string = '';

    private constructor() {
        // 单例模式
        this.initializeUserIdentifier();
        this.loadAdminUsersConfig();
    }

    /**
     * 获取 PermissionService 单例实例
     */
    public static getInstance(): PermissionService {
        if (!PermissionService.instance) {
            PermissionService.instance = new PermissionService();
        }
        return PermissionService.instance;
    }

    /**
     * 初始化当前用户标识符
     */
    private initializeUserIdentifier(): void {
        // 获取系统用户名
        const username = os.userInfo().username;
        this.currentUserIdentifier = username.toLowerCase(); // 转换为小写以便比较
        console.log(`[PermissionService] Current user identifier: ${this.currentUserIdentifier}`);
    }

    /**
     * 获取完整的用户账户信息
     */
    public getUserAccountInfo(): {
        username: string;
        uid: number;
        gid: number;
        homedir: string;
        shell: string;
        hostname: string;
        platform: string;
        arch: string;
    } {
        const userInfo = os.userInfo();
        return {
            username: userInfo.username,
            uid: userInfo.uid || -1,
            gid: userInfo.gid || -1,
            homedir: userInfo.homedir,
            shell: userInfo.shell || '',
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch()
        };
    }

    /**
     * 加载预设管理员配置文件
     */
    private loadAdminUsersConfig(): void {
        try {
            const builtinResourcesDir = directoryManager.getBuiltinResourcesDir();
            const adminConfigPath = path.join(builtinResourcesDir, 'admin-users.json');

            if (fs.existsSync(adminConfigPath)) {
                const content = fs.readFileSync(adminConfigPath, 'utf-8');
                this.adminUsersConfig = JSON.parse(content) as AdminUsersConfig;
                console.log(`[PermissionService] Loaded admin users config: ${this.adminUsersConfig.adminUsers.length} users`);
            } else {
                console.log(`[PermissionService] Admin users config not found at: ${adminConfigPath}`);
            }
        } catch (error) {
            console.error(`[PermissionService] Error loading admin users config:`, error);
        }
    }

    /**
     * 检查当前用户是否为预设管理员
     */
    private isPresetAdmin(): boolean {
        if (!this.adminUsersConfig) {
            return false;
        }

        // 检查用户名
        const isAdminByUsername = this.adminUsersConfig.adminUsers.some(
            adminUser => adminUser.toLowerCase() === this.currentUserIdentifier
        );

        if (isAdminByUsername) {
            console.log(`[PermissionService] User ${this.currentUserIdentifier} is a preset admin (by username)`);
            return true;
        }

        // 可以扩展其他检查方式（邮箱、MAC地址等）
        // 这里暂时只实现用户名检查

        return false;
    }

    /**
     * 获取当前用户角色
     * 如果用户是预设管理员且未设置过角色，自动设置为管理员
     */
    public getUserRole(): UserRole {
        const role = configStore.get('userRole') as UserRole | undefined;
        
        // 如果已设置过角色，直接返回
        if (role) {
            return role;
        }

        // 如果未设置过角色，检查是否为预设管理员
        if (this.isPresetAdmin()) {
            // 自动设置为管理员
            this.setUserRole('admin');
            console.log(`[PermissionService] Auto-set user ${this.currentUserIdentifier} as admin (preset)`);
            return 'admin';
        }

        // 默认为普通用户
        return 'user';
    }

    /**
     * 设置用户角色
     */
    public setUserRole(role: UserRole): void {
        configStore.set('userRole', role);
        console.log(`[PermissionService] User role set to: ${role}`);
    }

    /**
     * 获取当前用户标识符（用于调试）
     */
    public getCurrentUserIdentifier(): string {
        return this.currentUserIdentifier;
    }

    /**
     * 获取预设管理员列表（仅管理员可见）
     */
    public getPresetAdminUsers(): string[] {
        if (!this.isAdmin()) {
            return [];
        }
        return this.adminUsersConfig?.adminUsers || [];
    }

    /**
     * 添加预设管理员（仅管理员可操作）
     */
    public addPresetAdmin(username: string): boolean {
        if (!this.isAdmin()) {
            return false;
        }

        try {
            const builtinResourcesDir = directoryManager.getBuiltinResourcesDir();
            const adminConfigPath = path.join(builtinResourcesDir, 'admin-users.json');

            // 确保目录存在
            if (!fs.existsSync(builtinResourcesDir)) {
                fs.mkdirSync(builtinResourcesDir, { recursive: true });
            }

            // 加载现有配置或创建新配置
            let config: AdminUsersConfig;
            if (fs.existsSync(adminConfigPath)) {
                const content = fs.readFileSync(adminConfigPath, 'utf-8');
                config = JSON.parse(content);
            } else {
                config = {
                    version: '1.0.0',
                    adminUsers: []
                };
            }

            // 添加新管理员（如果不存在）
            const normalizedUsername = username.toLowerCase();
            if (!config.adminUsers.some(u => u.toLowerCase() === normalizedUsername)) {
                config.adminUsers.push(username); // 保持原始大小写
                fs.writeFileSync(adminConfigPath, JSON.stringify(config, null, 2), 'utf-8');
                this.loadAdminUsersConfig(); // 重新加载配置
                console.log(`[PermissionService] Added preset admin: ${username}`);
                return true;
            }

            return false; // 已存在
        } catch (error) {
            console.error(`[PermissionService] Error adding preset admin:`, error);
            return false;
        }
    }

    /**
     * 移除预设管理员（仅管理员可操作）
     */
    public removePresetAdmin(username: string): boolean {
        if (!this.isAdmin()) {
            return false;
        }

        try {
            const builtinResourcesDir = directoryManager.getBuiltinResourcesDir();
            const adminConfigPath = path.join(builtinResourcesDir, 'admin-users.json');

            if (!fs.existsSync(adminConfigPath)) {
                return false;
            }

            const content = fs.readFileSync(adminConfigPath, 'utf-8');
            const config = JSON.parse(content) as AdminUsersConfig;

            // 移除管理员
            const normalizedUsername = username.toLowerCase();
            config.adminUsers = config.adminUsers.filter(
                u => u.toLowerCase() !== normalizedUsername
            );

            fs.writeFileSync(adminConfigPath, JSON.stringify(config, null, 2), 'utf-8');
            this.loadAdminUsersConfig(); // 重新加载配置
            console.log(`[PermissionService] Removed preset admin: ${username}`);
            return true;
        } catch (error) {
            console.error(`[PermissionService] Error removing preset admin:`, error);
            return false;
        }
    }

    /**
     * 检查是否为超级管理员
     */
    public isAdmin(): boolean {
        return this.getUserRole() === 'admin';
    }

    /**
     * 检查是否可以编辑脚本（非官方脚本）
     */
    public canEditScript(_scriptId: string, isOfficial: boolean = false): boolean {
        if (isOfficial) {
            // 官方脚本只有管理员可以编辑
            return this.isAdmin();
        }
        // 非官方脚本所有用户都可以编辑（但删除需要检查）
        return true;
    }

    /**
     * 检查是否可以删除脚本
     */
    public canDeleteScript(_scriptId: string, isOfficial: boolean = false): boolean {
        if (isOfficial) {
            // 官方脚本不能被删除
            return false;
        }
        // 非官方脚本只有管理员可以删除
        return this.isAdmin();
    }

    /**
     * 检查是否可以重命名脚本
     */
    public canRenameScript(_scriptId: string, isOfficial: boolean = false): boolean {
        if (isOfficial) {
            // 官方脚本只有管理员可以重命名
            return this.isAdmin();
        }
        // 非官方脚本只有管理员可以重命名
        return this.isAdmin();
    }

    /**
     * 检查是否可以标记脚本为官方
     */
    public canMarkScriptOfficial(_scriptId: string): boolean {
        // 只有管理员可以标记脚本为官方
        return this.isAdmin();
    }

    /**
     * 检查是否可以编辑技能
     */
    public canEditSkill(_skillId: string, isBuiltin: boolean = false): boolean {
        if (isBuiltin) {
            // 内置技能只有管理员可以编辑
            return this.isAdmin();
        }
        // 用户技能所有用户都可以编辑
        return true;
    }

    /**
     * 检查是否可以删除技能
     */
    public canDeleteSkill(_skillId: string, isBuiltin: boolean = false): boolean {
        if (isBuiltin) {
            // 内置技能不能被删除
            return false;
        }
        // 用户技能只有管理员可以删除
        return this.isAdmin();
    }

    /**
     * 检查是否可以标记技能为内置
     */
    public canMarkSkillBuiltin(_skillId: string): boolean {
        // 只有管理员可以标记技能为内置
        return this.isAdmin();
    }

    /**
     * 检查是否可以编辑MCP
     */
    public canEditMCP(_mcpName: string, _isBuiltin: boolean = false): boolean {
        // MCP编辑对所有用户开放（但删除需要检查）
        return true;
    }

    /**
     * 检查是否可以删除MCP
     */
    public canDeleteMCP(_mcpName: string, isBuiltin: boolean = false): boolean {
        if (isBuiltin) {
            // 内置MCP不能被删除
            return false;
        }
        // 用户MCP只有管理员可以删除
        return this.isAdmin();
    }

    /**
     * 检查是否可以标记MCP为内置
     */
    public canMarkMCPBuiltin(_mcpName: string): boolean {
        // 只有管理员可以标记MCP为内置
        return this.isAdmin();
    }

    /**
     * 检查是否可以执行脚本（所有用户都可以执行）
     */
    public canExecuteScript(_scriptId: string): boolean {
        // 所有用户都可以执行脚本
        return true;
    }
}

// 导出单例实例
export const permissionService = PermissionService.getInstance();
