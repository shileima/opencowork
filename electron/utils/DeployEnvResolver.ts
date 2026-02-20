import * as path from 'path';
import { getBuiltinNodePath, getNpmEnvVars } from './NodePath';
import { getCommonPackageManagerPaths, detectPackageManager, type PackageManager } from './PathUtils';
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
  const buildCommand = packageManager === 'yarn' ? 'yarn build' : `${packageManager} run build`;

  let nodePath: string;
  let env: Record<string, string> = {};

  try {
    // waitForDownload=false 避免首次部署阻塞，用 builtin 兜底
    const projectNodeInfo = await nodeVersionManager.getNodePathForProject(projectPath, false);
    nodePath = projectNodeInfo.nodePath;
    env = projectNodeInfo.env || getNpmEnvVars();
  } catch {
    nodePath = getBuiltinNodePath();
    env = getNpmEnvVars();
  }

  // nvm/fnm 存在时不设置 NPM_CONFIG_PREFIX
  if (process.env.NVM_DIR || process.env.FNM_DIR) {
    delete env.NPM_CONFIG_PREFIX;
  }

  // 构建 PATH：nodeBinDir + commonPkgPaths + existingPath
  const nodeBinDir = nodePath && nodePath !== 'node' ? path.dirname(nodePath) : '';
  const pathParts = [nodeBinDir, ...commonPaths, process.env.PATH].filter(Boolean);
  env.PATH = pathParts.join(pathSeparator);

  // 合并 registry 等部署相关 env
  const deployEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    npm_config_registry: 'http://r.npm.sankuai.com/',
    FORCE_COLOR: '0',
  };

  return {
    env: deployEnv,
    nodePath,
    packageManager,
    buildCommand,
  };
}
