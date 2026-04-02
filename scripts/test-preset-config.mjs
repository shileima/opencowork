#!/usr/bin/env node

/**
 * 测试预设配置是否正确加载
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('='.repeat(60));
console.log('测试预设配置加载');
console.log('='.repeat(60));
console.log();

// 模拟 ConfigStore 的配置
const store = new Store({
    name: 'qa-cowork-config',
    cwd: join(process.env.HOME, 'Library', 'Application Support', 'qacowork')
});

console.log('配置文件路径:', store.path);
console.log();

// 读取配置
const providers = store.get('providers');

if (!providers) {
    console.error('❌ 未找到 providers 配置');
    process.exit(1);
}

console.log('找到的提供商:', Object.keys(providers));
console.log();

// 检查 custom 提供商
const customProvider = providers['custom'];

if (!customProvider) {
    console.error('❌ 未找到 custom 提供商');
    process.exit(1);
}

console.log('Custom 提供商配置:');
console.log('  ID:', customProvider.id);
console.log('  Name:', customProvider.name);
console.log('  API Key:', customProvider.apiKey ? `${customProvider.apiKey.substring(0, 10)}...` : '(empty)');
console.log('  API URL:', customProvider.apiUrl);
console.log('  Model:', customProvider.model);
console.log('  isCustom:', customProvider.isCustom);
console.log('  isPreset:', customProvider.isPreset);
console.log();

// 验证
const checks = [
    { name: 'API Key 不为空', pass: customProvider.apiKey && customProvider.apiKey.length > 0 },
    { name: 'API Key 不以 ENCRYPTED: 开头', pass: !customProvider.apiKey?.startsWith('ENCRYPTED:') },
    { name: 'isPreset 为 true', pass: customProvider.isPreset === true },
    { name: 'API URL 正确', pass: customProvider.apiUrl === 'https://newapi.waimai.st.sankuai.com' },
    { name: 'Model 正确', pass: customProvider.model === 'aws.claude-sonnet-4.5' }
];

console.log('验证结果:');
let allPassed = true;
for (const check of checks) {
    const status = check.pass ? '✅' : '❌';
    console.log(`  ${status} ${check.name}`);
    if (!check.pass) allPassed = false;
}
console.log();

if (allPassed) {
    console.log('🎉 所有检查通过！预设配置正确加载。');
    process.exit(0);
} else {
    console.log('❌ 部分检查失败，请检查配置。');
    process.exit(1);
}
