#!/usr/bin/env node

/**
 * API 密钥加密脚本
 * 用于在开发时加密 API 密钥，生成可以硬编码到代码中的加密字符串
 * 
 * 使用方法：
 * node scripts/encrypt-api-key.mjs
 */

import crypto from 'crypto';
import readline from 'readline';

const ALGORITHM = 'aes-256-cbc';
const APP_SECRET = 'qacowork-secret-2024';
const SALT = 'qacowork-salt';
const ITERATIONS = 100000;

/**
 * 生成加密密钥（固定密钥，跨机器通用）
 */
function getMachineKey() {
    return crypto.pbkdf2Sync(APP_SECRET, SALT, ITERATIONS, 32, 'sha256');
}

/**
 * 加密 API 密钥
 */
function encryptApiKey(plaintext) {
    try {
        const key = getMachineKey();
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        
        return iv.toString('base64') + ':' + encrypted;
    } catch (error) {
        console.error('Failed to encrypt:', error);
        throw error;
    }
}

/**
 * 解密 API 密钥（用于验证）
 */
function decryptApiKey(encrypted) {
    try {
        const key = getMachineKey();
        const parts = encrypted.split(':');
        
        if (parts.length !== 2) {
            throw new Error('Invalid encrypted format');
        }
        
        const iv = Buffer.from(parts[0], 'base64');
        const encryptedData = parts[1];
        
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Failed to decrypt:', error);
        throw error;
    }
}

/**
 * 主函数
 */
async function main() {
    console.log('='.repeat(60));
    console.log('API 密钥加密工具');
    console.log('='.repeat(60));
    console.log();
    
    console.log('加密密钥模式: 固定密钥（跨机器通用）');
    console.log();
    
    // 默认密钥（用户提供的）
    const defaultKey = 'sk-IxmaHhECm3gk3lgCD12246316c1543B58';
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const question = (query) => new Promise((resolve) => rl.question(query, resolve));
    
    try {
        console.log(`默认密钥: ${defaultKey}`);
        const useDefault = await question('使用默认密钥？(y/n，默认 y): ');
        
        let plainKey = defaultKey;
        if (useDefault.toLowerCase() === 'n') {
            plainKey = await question('请输入要加密的 API 密钥: ');
        }
        
        if (!plainKey || plainKey.trim().length === 0) {
            console.error('错误: API 密钥不能为空');
            process.exit(1);
        }
        
        console.log();
        console.log('正在加密...');
        
        // 加密
        const encrypted = encryptApiKey(plainKey);
        
        // 验证解密
        console.log('正在验证...');
        const decrypted = decryptApiKey(encrypted);
        
        if (decrypted !== plainKey) {
            console.error('错误: 加密验证失败！');
            process.exit(1);
        }
        
        console.log('✅ 加密成功并验证通过！');
        console.log();
        console.log('='.repeat(60));
        console.log('加密结果（复制以下内容到 ConfigStore.ts）:');
        console.log('='.repeat(60));
        console.log();
        console.log(`ENCRYPTED:${encrypted}`);
        console.log();
        console.log('='.repeat(60));
        console.log('完整配置示例:');
        console.log('='.repeat(60));
        console.log();
        console.log(`'custom': {
    id: 'custom',
    name: '自定义',
    apiKey: 'ENCRYPTED:${encrypted}',
    apiUrl: 'https://ccr.waimai.test.sankuai.com',
    model: 'oneapi,aws.claude-sonnet-4.5',
    maxTokens: 131072,
    isCustom: true,
    readonlyUrl: false,
    isPreset: true
}`);
        console.log();
        console.log('='.repeat(60));
        console.log('注意事项:');
        console.log('='.repeat(60));
        console.log('1. 加密密钥为固定密钥，所有机器均可解密');
        console.log('2. 请妥善保管原始 API 密钥');
        console.log('3. 加密后的字符串可以安全地提交到代码仓库');
        console.log();
        
    } catch (error) {
        console.error('发生错误:', error);
        process.exit(1);
    } finally {
        rl.close();
    }
}

// 运行主函数
main().catch(console.error);
