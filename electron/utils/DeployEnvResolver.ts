import * as path from 'path';
import * as fs from 'fs';
import { getBuiltinNodePath, getBuiltinNpmPath, getNpmEnvVars } from './NodePath';
import { getCommonPackageManagerPaths, detectPackageManager, getLocalBuildCommand, type PackageManager } from './PathUtils';
import { nodeVersionManager } from './NodeVersionManager';

export interface DeployEnvResult {
  env: NodeJS.ProcessEnv;
  nodePath: string;
  packageManager: PackageManager;
  buildCommand: string;
}

/**
 * 为 deploy 子进程解析 Node 环境
 * 优先级：项目 Node 版本 > 内置 Node > 用户 PATH
 * nvm 存在时不设置 NPM_CONFIG_PREFIX，避免冲突
 */
export async function resolveDeployEnv(projectPath: string): Promise<DeployEnvResult> {
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const commonPaths = getCommonPackageManagerPaths();
  const packageManager = detectPackageManager(projectPath);

  // 优先使用项目本地 node_modules/.bin 下的包管理器，避免依赖全局 pnpm
  const localBuildCommand = getLocalBuildCommand(projectPath, packageManager);
  const buildCommand = localBuildCommand ?? (packageManager === 'yarn' ? 'yarn build' : `${packageManager} run build`);

  let nodePath: string;
  let env: Record<string, string> = {};

  try {
    // waitForDownload=true：部署必须使用可控 Node（内置或缓存），避免回退到系统 node
    // 系统 node（如 Homebrew 25）的 npm 路径可能异常，导致 "Could not determine Node.js install directory"
    const projectNodeInfo = await nodeVersionManager.getNodePathForProject(projectPath, true);
    nodePath = projectNodeInfo.nodePath;
    env = projectNodeInfo.env && Object.keys(projectNodeInfo.env).length > 0
      ? projectNodeInfo.env
      : getNpmEnvVars();
  } catch {
    nodePath = getBuiltinNodePath();
    env = getNpmEnvVars();
  }

  // 仅当使用系统 node 时清除 NPM_CONFIG_PREFIX（避免与 nvm 冲突）
  // 使用内置/缓存 Node 时必须保留，否则 npm 会查找错误路径（如 20.18.0/lib 而非 20.18.0/darwin-arm64/lib）
  const usingOurNode = nodePath && nodePath !== 'node' && fs.existsSync(nodePath);
  if ((process.env.NVM_DIR || process.env.FNM_DIR) && !usingOurNode) {
    delete env.NPM_CONFIG_PREFIX;
  }

  // 构建 PATH：nodeBinDir + npmBinDir + commonPkgPaths + existingPath
  // 必须包含 npmBinDir，否则 npx/npm 会报 "Could not determine Node.js install directory"
  const nodeBinDir = nodePath && nodePath !== 'node' ? path.dirname(nodePath) : '';
  const npmPath = getBuiltinNpmPath();
  const npmBinDir = npmPath && npmPath !== 'npm' ? path.dirname(npmPath) : '';
  const pathParts = [nodeBinDir, npmBinDir, ...commonPaths, process.env.PATH].filter(Boolean);
  env.PATH = pathParts.join(pathSeparator);

  // 合并 registry 等部署相关 env
  const deployEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    npm_config_registry: 'http://r.npm.sankuai.com/',
    FORCE_COLOR: '0',
  };

  // 仅当使用系统 node 时清除 NPM_CONFIG_PREFIX
  if ((process.env.NVM_DIR || process.env.FNM_DIR) && !usingOurNode) {
    delete deployEnv.NPM_CONFIG_PREFIX;
  }

  // 设置 NODE 环境变量，部分工具据此解析 Node 路径
  if (nodePath && nodePath !== 'node' && fs.existsSync(nodePath)) {
    deployEnv.NODE = nodePath;
  }

  return {
    env: deployEnv,
    nodePath,
    packageManager,
    buildCommand,
  };
}
