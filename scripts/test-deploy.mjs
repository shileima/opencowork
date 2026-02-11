#!/usr/bin/env node

/**
 * 部署脚本测试
 * 用于验证部署脚本的各项功能
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

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
  section: (msg) => console.log(`\n${colors.blue}━━━ ${msg} ━━━${colors.reset}\n`),
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * 运行测试
 */
function test(name, fn) {
  try {
    fn();
    log.success(`测试通过: ${name}`);
    testsPassed++;
  } catch (error) {
    log.error(`测试失败: ${name}`);
    console.error(`  ${error.message}`);
    testsFailed++;
  }
}

/**
 * 断言
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * 主测试函数
 */
function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.cyan}部署脚本测试${colors.reset}`);
  console.log('='.repeat(60) + '\n');

  // 测试 1: 检查部署脚本是否存在
  log.section('文件检查');
  test('部署脚本存在', () => {
    const scriptPath = join(rootDir, 'scripts/deploy.mjs');
    assert(existsSync(scriptPath), '部署脚本不存在');
  });

  test('package.json 包含 deploy 命令', () => {
    const pkgPath = join(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    assert(pkg.scripts.deploy, 'package.json 中缺少 deploy 命令');
    assert(pkg.scripts.deploy.includes('deploy.mjs'), 'deploy 命令配置不正确');
  });

  test('.env.example 文件存在', () => {
    const envExamplePath = join(rootDir, '.env.example');
    assert(existsSync(envExamplePath), '.env.example 文件不存在');
  });

  test('.gitignore 包含 .env', () => {
    const gitignorePath = join(rootDir, '.gitignore');
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    assert(gitignore.includes('.env'), '.gitignore 中缺少 .env');
  });

  // 测试 2: 检查 webstatic 是否安装
  log.section('工具检查');
  test('webstatic 已安装', () => {
    try {
      const version = execSync('webstatic --version', { encoding: 'utf-8' }).trim();
      assert(version.includes('webstatic'), 'webstatic 版本信息不正确');
    } catch (error) {
      throw new Error('webstatic 未安装');
    }
  });

  // 测试 3: 检查环境变量配置
  log.section('环境变量检查');
  test('WEBSTATIC_APPKEY 已配置', () => {
    const hasAppkey = !!process.env.WEBSTATIC_APPKEY;
    if (!hasAppkey) {
      log.warning('WEBSTATIC_APPKEY 未配置（这是可选的，但部署时需要）');
    }
  });

  test('WEBSTATIC_TOKEN 已配置', () => {
    const hasToken = !!process.env.WEBSTATIC_TOKEN;
    if (!hasToken) {
      log.warning('WEBSTATIC_TOKEN 未配置（这是可选的，但部署时需要）');
    }
  });

  // 测试 4: 检查文档
  log.section('文档检查');
  test('部署文档存在', () => {
    const docPath = join(rootDir, 'docs/DEPLOYMENT.md');
    assert(existsSync(docPath), '部署文档不存在');
  });

  test('快速开始文档存在', () => {
    const docPath = join(rootDir, 'docs/DEPLOYMENT_QUICKSTART.md');
    assert(existsSync(docPath), '快速开始文档不存在');
  });

  test('文档索引存在', () => {
    const docPath = join(rootDir, 'docs/README.md');
    assert(existsSync(docPath), '文档索引不存在');
  });

  // 测试 5: 检查部署脚本语法
  log.section('脚本语法检查');
  test('部署脚本语法正确', () => {
    try {
      execSync('node --check scripts/deploy.mjs', {
        cwd: rootDir,
        encoding: 'utf-8',
      });
    } catch (error) {
      throw new Error('部署脚本语法错误');
    }
  });

  // 测试总结
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.cyan}测试总结${colors.reset}`);
  console.log('='.repeat(60));
  console.log(`${colors.green}通过: ${testsPassed}${colors.reset}`);
  console.log(`${colors.red}失败: ${testsFailed}${colors.reset}`);
  console.log(`总计: ${testsPassed + testsFailed}`);
  console.log('='.repeat(60) + '\n');

  if (testsFailed > 0) {
    log.error('部分测试失败，请检查上述错误信息');
    process.exit(1);
  } else {
    log.success('所有测试通过！');
    
    // 显示下一步提示
    console.log('\n' + '='.repeat(60));
    console.log(`${colors.cyan}下一步${colors.reset}`);
    console.log('='.repeat(60));
    console.log('1. 配置环境变量：');
    console.log('   cp .env.example .env');
    console.log('   vim .env  # 填入你的 WEBSTATIC_APPKEY 和 WEBSTATIC_TOKEN');
    console.log('');
    console.log('2. 运行部署：');
    console.log('   pnpm run deploy');
    console.log('');
    console.log('3. 查看文档：');
    console.log('   cat docs/DEPLOYMENT_QUICKSTART.md');
    console.log('='.repeat(60) + '\n');
  }
}

// 运行测试
runTests();
