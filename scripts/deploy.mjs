#!/usr/bin/env node

/**
 * 部署脚本 - 用于将项目部署到美团 CDN
 * 
 * 功能：
 * 1. 检查 webstatic 可用性（npx @bfe/webstatic，无需全局安装）
 * 2. 构建项目
 * 3. 上传到 CDN
 * 4. 生成部署报告
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/**
 * 加载 .env 文件
 */
function loadEnv() {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  
  const envContent = readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=').trim();
    
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

// 加载环境变量
loadEnv();

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
};

/**
 * 检查 webstatic 可用性（通过 npx @bfe/webstatic，无需全局安装）
 */
function checkWebstatic() {
  try {
    execSync('pnpm config set registry http://r.npm.sankuai.com/', { stdio: 'pipe' });
  } catch (_) { /* ignore */ }
  const env = { ...process.env, npm_config_registry: 'http://r.npm.sankuai.com/' };
  try {
    execSync('npx @bfe/webstatic --version', { encoding: 'utf-8', env });
    log.success('webstatic 可用 (npx @bfe/webstatic)');
    return true;
  } catch (error) {
    log.error('无法运行 @bfe/webstatic，请确保 registry 正确：');
    log.info('  pnpm config set registry http://r.npm.sankuai.com/');
    return false;
  }
}

/**
 * 读取 package.json
 */
function getPackageInfo() {
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
  };
}

/**
 * 更新版本号
 */
function bumpVersion(type = 'patch') {
  const pkgPath = join(rootDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  
  let newVersion;
  switch (type) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    case 'patch':
    default:
      newVersion = `${major}.${minor}.${patch + 1}`;
      break;
  }
  
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  
  log.success(`版本号已更新: ${oldVersion} -> ${newVersion}`);
  return newVersion;
}

/**
 * 构建项目
 */
function buildProject() {
  log.info('开始构建项目...');
  try {
    execSync('pnpm run build', {
      cwd: rootDir,
      stdio: 'inherit',
    });
    log.success('项目构建完成');
    return true;
  } catch (error) {
    log.error('项目构建失败');
    return false;
  }
}

/**
 * 读取环境变量配置
 */
function getDeployConfig() {
  const appkey = process.env.WEBSTATIC_APPKEY;
  const token = process.env.WEBSTATIC_TOKEN;
  const env = process.env.WEBSTATIC_ENV || 'prod';
  
  if (!appkey || !token) {
    log.error('缺少必要的环境变量配置');
    log.info('请在 .env 文件中配置以下变量：');
    log.info('  WEBSTATIC_APPKEY=你的appkey');
    log.info('  WEBSTATIC_TOKEN=你的token');
    log.info('  WEBSTATIC_ENV=prod (可选，默认为 prod)');
    log.info('');
    log.info('或者在命令行中设置：');
    log.info('  export WEBSTATIC_APPKEY=你的appkey');
    log.info('  export WEBSTATIC_TOKEN=你的token');
    return null;
  }
  
  return { appkey, token, env };
}

/**
 * 部署到 CDN
 */
function deployToCDN(projectName, version) {
  log.info('开始部署到 CDN...');
  
  const distDir = join(rootDir, 'dist');
  if (!existsSync(distDir)) {
    log.error('dist 目录不存在，请先构建项目');
    return false;
  }
  
  // 获取部署配置
  const config = getDeployConfig();
  if (!config) {
    return false;
  }
  
  try {
    // 使用 webstatic 上传
    // 上传 dist 目录下的所有文件
    const env = { ...process.env, npm_config_registry: 'http://r.npm.sankuai.com/' };
    const command = `npx @bfe/webstatic upload "**/*" --cwd="${distDir}" --appkey="${config.appkey}" --token="${config.token}" --env="${config.env}" --skip-duplicate`;
    
    log.info(`上传环境: ${config.env}`);
    log.info(`项目标识: ${config.appkey}`);
    log.info('开始上传文件...');
    
    execSync(command, {
      cwd: rootDir,
      stdio: 'inherit',
      env,
    });
    
    // 构建 CDN URL
    const cdnUrl = `https://aie.sankuai.com/${config.appkey}/${projectName}/${version}/`;
    log.success(`部署成功！`);
    log.info(`CDN 地址: ${colors.blue}${cdnUrl}${colors.reset}`);
    
    return cdnUrl;
  } catch (error) {
    log.error('部署失败');
    console.error(error);
    return false;
  }
}

/**
 * 生成部署报告
 */
function generateReport(info, cdnUrl) {
  const report = {
    name: info.name,
    version: info.version,
    description: info.description,
    cdnUrl: cdnUrl,
    deployTime: new Date().toISOString(),
  };
  
  const reportPath = join(rootDir, 'deploy-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  
  log.success(`部署报告已生成: ${reportPath}`);
  
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.green}部署完成！${colors.reset}`);
  console.log('='.repeat(60));
  console.log(`项目名称: ${info.name}`);
  console.log(`版本号: ${info.version}`);
  console.log(`CDN 地址: ${colors.blue}${cdnUrl}${colors.reset}`);
  console.log(`部署时间: ${report.deployTime}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * 主函数
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.cyan}开始部署流程${colors.reset}`);
  console.log('='.repeat(60) + '\n');
  
  // 1. 检查 webstatic
  if (!checkWebstatic()) {
    process.exit(1);
  }
  
  // 2. 获取项目信息
  const info = getPackageInfo();
  log.info(`项目: ${info.name} v${info.version}`);
  
  // 3. 询问是否更新版本号
  const args = process.argv.slice(2);
  const skipBump = args.includes('--skip-bump');
  const bumpType = args.find(arg => ['--major', '--minor', '--patch'].includes(arg))?.replace('--', '') || 'patch';
  
  if (!skipBump) {
    const newVersion = bumpVersion(bumpType);
    info.version = newVersion;
  }
  
  // 4. 构建项目
  const skipBuild = args.includes('--skip-build');
  if (!skipBuild) {
    if (!buildProject()) {
      process.exit(1);
    }
  } else {
    log.warning('跳过构建步骤');
  }
  
  // 5. 部署到 CDN
  const cdnUrl = deployToCDN(info.name, info.version);
  if (!cdnUrl) {
    process.exit(1);
  }
  
  // 6. 生成报告
  generateReport(info, cdnUrl);
}

// 运行主函数
main().catch((error) => {
  log.error('部署过程中出现错误');
  console.error(error);
  process.exit(1);
});
