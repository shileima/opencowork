import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import https from 'https';
import semver from 'semver';
import { directoryManager } from '../config/DirectoryManager';
import { getBuiltinNodePath } from './NodePath';

interface VersionManifest {
    versions: {
        [version: string]: {
            platforms: string[];
            downloadedAt: string;
            lastUsed?: string;
        };
    };
}

/**
 * Node.js 版本管理器
 * 自动检测项目所需的 Node.js 版本，并在需要时下载和使用正确的版本
 */
export class NodeVersionManager {
    private static instance: NodeVersionManager;
    private versionsDir: string;
    private manifestPath: string;
    private manifest: VersionManifest;
    private downloadingVersions: Set<string> = new Set();

    private constructor() {
        this.versionsDir = path.join(directoryManager.getBaseDir(), 'node-versions');
        this.manifestPath = path.join(this.versionsDir, 'manifest.json');
        this.manifest = this.loadManifest();
        this.ensureVersionsDir();
    }

    public static getInstance(): NodeVersionManager {
        if (!NodeVersionManager.instance) {
            NodeVersionManager.instance = new NodeVersionManager();
        }
        return NodeVersionManager.instance;
    }

    /**
     * 确保版本目录存在
     */
    private ensureVersionsDir(): void {
        if (!fs.existsSync(this.versionsDir)) {
            fs.mkdirSync(this.versionsDir, { recursive: true });
        }
    }

    /**
     * 加载版本清单
     */
    private loadManifest(): VersionManifest {
        try {
            if (fs.existsSync(this.manifestPath)) {
                const content = fs.readFileSync(this.manifestPath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.warn('[NodeVersionManager] Failed to load manifest:', error);
        }
        return { versions: {} };
    }

    /**
     * 保存版本清单
     */
    private saveManifest(): void {
        try {
            fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
        } catch (error) {
            console.error('[NodeVersionManager] Failed to save manifest:', error);
        }
    }

    /**
     * 检测项目需要的 Node.js 版本
     * 优先级：package.json engines.node > .nvmrc
     */
    public detectRequiredVersion(projectPath: string): string | null {
        if (!projectPath || !fs.existsSync(projectPath)) {
            return null;
        }

        // 1. 优先检查 package.json 的 engines.node
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                if (packageJson.engines?.node) {
                    const requiredRange = packageJson.engines.node;
                    console.debug(`[NodeVersionManager] Found engines.node in package.json: ${requiredRange}`);
                    return this.resolveVersionFromRange(requiredRange);
                }
            } catch (error) {
                console.warn('[NodeVersionManager] Failed to parse package.json:', error);
            }
        }

        // 2. 备选检查 .nvmrc
        const nvmrcPath = path.join(projectPath, '.nvmrc');
        if (fs.existsSync(nvmrcPath)) {
            try {
                const nvmrcContent = fs.readFileSync(nvmrcPath, 'utf-8').trim();
                console.debug(`[NodeVersionManager] Found .nvmrc: ${nvmrcContent}`);
                // .nvmrc 通常是精确版本或版本范围
                return this.resolveVersionFromRange(nvmrcContent);
            } catch (error) {
                console.warn('[NodeVersionManager] Failed to read .nvmrc:', error);
            }
        }

        return null;
    }

    /**
     * 从版本范围解析出具体的版本号
     * 例如：">=20" -> "20.18.0", "^18.17.0 || >=20.0.0" -> "20.18.0"
     */
    private resolveVersionFromRange(range: string): string | null {
        try {
            // 如果是精确版本，直接返回
            if (semver.valid(range)) {
                return range;
            }

            // 解析范围，选择满足要求的最低 LTS 版本
            // 优先选择 Node.js 20.x LTS，然后是 18.x LTS
            const ltsVersions = ['20.18.0', '18.20.0', '22.11.0']; // 当前 LTS 版本

            for (const ltsVersion of ltsVersions) {
                if (semver.satisfies(ltsVersion, range)) {
                    console.debug(`[NodeVersionManager] Resolved range ${range} to ${ltsVersion}`);
                    return ltsVersion;
                }
            }

            // 如果没有 LTS 版本满足，尝试获取满足范围的最新版本
            // 这里简化处理，返回一个合理的默认值
            if (semver.validRange(range)) {
                // 如果范围要求 >= 某个版本，返回该版本
                const match = range.match(/>=(\d+\.\d+\.\d+)/);
                if (match) {
                    return match[1];
                }
                // 如果范围要求 ^ 某个版本，返回该版本
                const caretMatch = range.match(/\^(\d+\.\d+\.\d+)/);
                if (caretMatch) {
                    return caretMatch[1];
                }
            }

            console.warn(`[NodeVersionManager] Could not resolve version range: ${range}`);
            return null;
        } catch (error) {
            console.error('[NodeVersionManager] Error resolving version range:', error);
            return null;
        }
    }

    /**
     * 检查版本兼容性
     */
    public checkVersionCompatibility(currentVersion: string, requiredRange: string): boolean {
        try {
            // 清理版本号（移除 'v' 前缀）
            const cleanVersion = currentVersion.replace(/^v/, '');
            return semver.satisfies(cleanVersion, requiredRange);
        } catch (error) {
            console.error('[NodeVersionManager] Error checking version compatibility:', error);
            return false;
        }
    }

    /**
     * 获取内置 Node.js 版本
     */
    private getBuiltinNodeVersion(): string | null {
        try {
            const builtinNodePath = getBuiltinNodePath();
            if (!builtinNodePath || builtinNodePath === 'node') {
                return null;
            }
            const versionOutput = execSync(`"${builtinNodePath}" --version`, { encoding: 'utf-8' }).trim();
            return versionOutput.replace(/^v/, '');
        } catch (error) {
            console.warn('[NodeVersionManager] Failed to get builtin Node.js version:', error);
            return null;
        }
    }

    /**
     * 获取项目应使用的 Node.js 路径
     * 如果内置版本满足要求，返回内置路径
     * 否则检查缓存，如果没有则触发下载
     * @param projectPath 项目路径
     * @param waitForDownload 如果版本需要下载，是否等待下载完成（默认 false，异步下载）
     */
    public async getNodePathForProject(projectPath: string, waitForDownload: boolean = false): Promise<{ nodePath: string; npmPath: string | null; env: Record<string, string> }> {
        let requiredVersion = this.detectRequiredVersion(projectPath);
        
        // 如果没有版本要求，默认使用 Node.js 20
        if (!requiredVersion) {
            requiredVersion = '20.18.0'; // 默认使用 Node.js 20 LTS
            console.debug('[NodeVersionManager] No version requirement found, defaulting to Node.js 20.18.0');
        } else {
            console.debug(`[NodeVersionManager] Project requires Node.js ${requiredVersion}`);
        }

        // 检查内置版本是否满足要求
        const builtinVersion = this.getBuiltinNodeVersion();
        if (builtinVersion) {
            // 对于默认的 20.18.0，检查内置版本是否 >= 20.0.0
            // 对于其他版本，检查是否满足主版本号要求
            const majorVersion = requiredVersion.split('.')[0];
            const versionRange = `>=${majorVersion}.0.0`;
            if (this.checkVersionCompatibility(builtinVersion, versionRange)) {
                console.debug(`[NodeVersionManager] Builtin version ${builtinVersion} satisfies requirement ${requiredVersion} (${versionRange})`);
                return {
                    nodePath: getBuiltinNodePath(),
                    npmPath: null,
                    env: {}
                };
            }
        }

        // 检查缓存版本
        const cachedPath = this.getCachedNodePath(requiredVersion);
        if (cachedPath) {
            console.debug(`[NodeVersionManager] Using cached Node.js ${requiredVersion} at ${cachedPath.nodePath}`);
            this.updateLastUsed(requiredVersion);
            return cachedPath;
        }

        // 如果正在下载，等待下载完成
        if (this.downloadingVersions.has(requiredVersion)) {
            console.log(`[NodeVersionManager] Node.js ${requiredVersion} is already downloading, waiting...`);
            // 轮询等待下载完成
            while (this.downloadingVersions.has(requiredVersion)) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            // 下载完成后，再次检查缓存
            const cachedAfterDownload = this.getCachedNodePath(requiredVersion);
            if (cachedAfterDownload) {
                console.debug(`[NodeVersionManager] Using downloaded Node.js ${requiredVersion} at ${cachedAfterDownload.nodePath}`);
                this.updateLastUsed(requiredVersion);
                return cachedAfterDownload;
            }
        }

        // 缓存不存在，需要下载
        if (waitForDownload) {
            // 等待下载完成
            console.log(`[NodeVersionManager] Node.js ${requiredVersion} not cached, downloading now (waiting for completion)...`);
            try {
                await this.downloadNodeVersion(requiredVersion);
                const downloadedPath = this.getCachedNodePath(requiredVersion);
                if (downloadedPath) {
                    console.log(`[NodeVersionManager] Successfully downloaded and ready to use Node.js ${requiredVersion} at ${downloadedPath.nodePath}`);
                    this.updateLastUsed(requiredVersion);
                    return downloadedPath;
                } else {
                    // 下载完成但路径获取失败，这不应该发生
                    console.error(`[NodeVersionManager] Download completed but failed to get cached path for ${requiredVersion}`);
                    throw new Error(`Failed to get cached path after download`);
                }
            } catch (error) {
                console.error(`[NodeVersionManager] Failed to download Node.js ${requiredVersion}:`, error);
                // 下载失败，回退到内置版本
                console.warn(`[NodeVersionManager] Falling back to builtin version due to download failure`);
                return {
                    nodePath: getBuiltinNodePath(),
                    npmPath: null,
                    env: {}
                };
            }
        } else {
            // 异步下载，不阻塞
            console.log(`[NodeVersionManager] Node.js ${requiredVersion} not cached, starting download in background...`);
            this.downloadNodeVersion(requiredVersion).catch(error => {
                console.error(`[NodeVersionManager] Failed to download Node.js ${requiredVersion}:`, error);
            });
            
            // 下载期间回退到内置版本
            console.warn(`[NodeVersionManager] Node.js ${requiredVersion} is downloading in background, falling back to builtin version`);
            return {
                nodePath: getBuiltinNodePath(),
                npmPath: null,
                env: {}
            };
        }
    }

    /**
     * 获取缓存的 Node.js 路径
     */
    private getCachedNodePath(version: string): { nodePath: string; npmPath: string | null; env: Record<string, string> } | null {
        const platform = process.platform;
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const platformKey = platform === 'win32' ? 'win32-x64' : `${platform}-${arch}`;

        const versionDir = path.join(this.versionsDir, version, platformKey);
        const nodeExecutable = platform === 'win32' ? 'node.exe' : 'node';
        const nodePath = path.join(versionDir, nodeExecutable);

        if (!fs.existsSync(nodePath)) {
            return null;
        }

        // 确保有执行权限
        if (platform !== 'win32') {
            try {
                fs.chmodSync(nodePath, 0o755);
            } catch (error) {
                console.warn(`[NodeVersionManager] Failed to set executable permission: ${error}`);
            }
        }

        // 查找 npm
        const npmPath = this.findNpmPath(versionDir, platform);

        // 构建环境变量
        const env = this.buildEnvVars(versionDir, nodePath, npmPath, platform);

        return {
            nodePath,
            npmPath,
            env
        };
    }

    /**
     * 查找 npm 路径
     */
    private findNpmPath(versionDir: string, platform: string): string | null {
        const possibleNpmPaths = [
            path.join(versionDir, platform === 'win32' ? 'npm.cmd' : 'npm'),
            path.join(versionDir, 'lib', 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm'),
            path.join(versionDir, 'node_modules', 'npm', 'bin', platform === 'win32' ? 'npm.cmd' : 'npm'),
        ];

        for (const npmPath of possibleNpmPaths) {
            if (fs.existsSync(npmPath)) {
                if (platform !== 'win32') {
                    try {
                        fs.chmodSync(npmPath, 0o755);
                    } catch (error) {
                        // 忽略错误
                    }
                }
                return npmPath;
            }
        }

        return null;
    }

    /**
     * 构建环境变量
     */
    private buildEnvVars(versionDir: string, nodePath: string, npmPath: string | null, platform: string): Record<string, string> {
        const env: Record<string, string> = {};
        const nodeBinDir = path.dirname(nodePath);
        const existingPath = process.env.PATH || '';
        const pathSeparator = platform === 'win32' ? ';' : ':';

        env.PATH = `${nodeBinDir}${pathSeparator}${existingPath}`;

        if (npmPath) {
            const npmBinDir = path.dirname(npmPath);
            env.PATH = `${nodeBinDir}${pathSeparator}${npmBinDir}${pathSeparator}${existingPath}`;
        }

        const npmModuleDir = path.join(versionDir, 'lib', 'node_modules');
        if (fs.existsSync(npmModuleDir)) {
            const existingNodePath = process.env.NODE_PATH || '';
            env.NODE_PATH = existingNodePath
                ? `${npmModuleDir}${path.delimiter}${existingNodePath}`
                : npmModuleDir;
        }

        env.NPM_CONFIG_PREFIX = versionDir;

        return env;
    }

    /**
     * 更新最后使用时间
     */
    private updateLastUsed(version: string): void {
        if (!this.manifest.versions[version]) {
            this.manifest.versions[version] = {
                platforms: [],
                downloadedAt: new Date().toISOString()
            };
        }
        this.manifest.versions[version].lastUsed = new Date().toISOString();
        this.saveManifest();
    }

    /**
     * 下载指定版本的 Node.js
     */
    private async downloadNodeVersion(version: string): Promise<void> {
        // 防止重复下载
        if (this.downloadingVersions.has(version)) {
            console.debug(`[NodeVersionManager] Node.js ${version} is already being downloaded`);
            return;
        }

        const platform = process.platform;
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const platformKey = platform === 'win32' ? 'win32-x64' : `${platform}-${arch}`;

        // 检查是否已经下载
        const cachedPath = this.getCachedNodePath(version);
        if (cachedPath) {
            console.debug(`[NodeVersionManager] Node.js ${version} already cached`);
            return;
        }

        this.downloadingVersions.add(version);
        console.log(`[NodeVersionManager] Starting download of Node.js ${version} for ${platformKey}`);

        try {
            await this.downloadAndExtractNode(version, platform, arch, platformKey);
            
            // 准备 npm（从下载的包中复制或使用内置 npm）
            await this.prepareNpmForVersion(version, platformKey);

            // 更新清单
            if (!this.manifest.versions[version]) {
                this.manifest.versions[version] = {
                    platforms: [],
                    downloadedAt: new Date().toISOString()
                };
            }
            if (!this.manifest.versions[version].platforms.includes(platformKey)) {
                this.manifest.versions[version].platforms.push(platformKey);
            }
            this.saveManifest();

            console.log(`[NodeVersionManager] Successfully downloaded Node.js ${version} for ${platformKey}`);
        } catch (error) {
            console.error(`[NodeVersionManager] Failed to download Node.js ${version}:`, error);
            throw error;
        } finally {
            this.downloadingVersions.delete(version);
        }
    }

    /**
     * 下载并解压 Node.js
     */
    private async downloadAndExtractNode(version: string, platform: string, arch: string, platformKey: string): Promise<void> {
        const distName = platform === 'win32' ? 'win-x64' : `${platform}-${arch}`;
        const ext = platform === 'win32' ? 'zip' : 'tar.gz';
        const nodeDistName = `node-v${version}-${distName}`;
        const downloadUrl = `https://nodejs.org/dist/v${version}/${nodeDistName}.${ext}`;

        console.log(`[NodeVersionManager] Downloading from: ${downloadUrl}`);

        const versionDir = path.join(this.versionsDir, version, platformKey);
        fs.mkdirSync(versionDir, { recursive: true });

        const tempDir = path.join(this.versionsDir, '.temp');
        fs.mkdirSync(tempDir, { recursive: true });

        const downloadPath = path.join(tempDir, `${nodeDistName}.${ext}`);

        try {
            // 下载文件
            await this.downloadFile(downloadUrl, downloadPath);

            // 解压
            const extractDir = path.join(tempDir, nodeDistName);
            if (fs.existsSync(extractDir)) {
                fs.rmSync(extractDir, { recursive: true, force: true });
            }
            fs.mkdirSync(extractDir, { recursive: true });

            if (ext === 'tar.gz') {
                await this.extractTarGz(downloadPath, tempDir);
            } else {
                await this.extractZip(downloadPath, tempDir);
            }

            // 复制 node 二进制文件
            const nodeExecutable = platform === 'win32' ? 'node.exe' : 'node';
            const extractedBinDir = path.join(extractDir, platform === 'win32' ? '' : 'bin');
            const extractedNode = path.join(extractedBinDir, nodeExecutable);

            if (!fs.existsSync(extractedNode)) {
                throw new Error(`Cannot find extracted node binary: ${extractedNode}`);
            }

            const targetNodePath = path.join(versionDir, nodeExecutable);
            fs.copyFileSync(extractedNode, targetNodePath);

            if (platform !== 'win32') {
                fs.chmodSync(targetNodePath, 0o755);
            }

            console.log(`[NodeVersionManager] Extracted node to: ${targetNodePath}`);

            // 复制 npm 相关文件（如果存在）
            const extractedLibDir = path.join(extractDir, 'lib', 'node_modules', 'npm');
            if (fs.existsSync(extractedLibDir)) {
                const targetLibDir = path.join(versionDir, 'lib', 'node_modules', 'npm');
                fs.mkdirSync(path.dirname(targetLibDir), { recursive: true });
                fs.cpSync(extractedLibDir, targetLibDir, { recursive: true });
                console.log(`[NodeVersionManager] Copied npm module to: ${targetLibDir}`);
            }

        } finally {
            // 清理临时文件
            if (fs.existsSync(downloadPath)) {
                fs.unlinkSync(downloadPath);
            }
            const extractDir = path.join(tempDir, nodeDistName);
            if (fs.existsSync(extractDir)) {
                fs.rmSync(extractDir, { recursive: true, force: true });
            }
        }
    }

    /**
     * 下载文件
     */
    private async downloadFile(url: string, dest: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            https.get(url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    return this.downloadFile(response.headers.location!, dest).then(resolve).catch(reject);
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                let downloadedSize = 0;
                let lastProgress = 0;

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        const progress = Math.floor((downloadedSize / totalSize) * 100);
                        if (progress - lastProgress >= 10) {
                            console.debug(`[NodeVersionManager] Download progress: ${progress}%`);
                            lastProgress = progress;
                        }
                    }
                });

                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => {});
                reject(err);
            });
        });
    }

    /**
     * 解压 tar.gz
     */
    private async extractTarGz(tarPath: string, destDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: 'inherit' });
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 解压 zip
     */
    private async extractZip(zipPath: string, destDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                if (process.platform === 'win32') {
                    execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
                } else {
                    execSync(`unzip -q "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * 为下载的 Node.js 版本准备 npm
     */
    private async prepareNpmForVersion(version: string, platformKey: string): Promise<void> {
        const versionDir = path.join(this.versionsDir, version, platformKey);
        const npmModuleDir = path.join(versionDir, 'lib', 'node_modules', 'npm');

            // 如果下载的包中已经有 npm，直接使用
            if (fs.existsSync(npmModuleDir)) {
                console.debug(`[NodeVersionManager] npm already exists in downloaded package`);
            // 创建 npm 可执行文件的符号链接或复制
            const npmBinDir = path.join(npmModuleDir, 'bin');
            const npmScript = path.join(npmBinDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
            if (fs.existsSync(npmScript)) {
                const targetNpm = path.join(versionDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
                if (!fs.existsSync(targetNpm)) {
                    fs.copyFileSync(npmScript, targetNpm);
                    if (process.platform !== 'win32') {
                        fs.chmodSync(targetNpm, 0o755);
                    }
                }
            }
            return;
        }

        // 如果没有 npm，尝试从内置版本复制（仅 macOS）
        if (process.platform === 'darwin') {
            try {
                const builtinNodeDir = path.dirname(getBuiltinNodePath());
                const builtinNpmModuleDir = path.join(builtinNodeDir, 'lib', 'node_modules', 'npm');
                if (fs.existsSync(builtinNpmModuleDir)) {
                    console.log(`[NodeVersionManager] Copying npm from builtin version`);
                    fs.mkdirSync(path.dirname(npmModuleDir), { recursive: true });
                    fs.cpSync(builtinNpmModuleDir, npmModuleDir, { recursive: true });
                }
            } catch (error) {
                console.warn(`[NodeVersionManager] Failed to copy npm from builtin: ${error}`);
            }
        }
    }
}

export const nodeVersionManager = NodeVersionManager.getInstance();
