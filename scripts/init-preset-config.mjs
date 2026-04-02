#!/usr/bin/env node

/**
 * 初始化预设配置（模拟 ConfigStore 初始化）
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Store from 'electron-store';
import crypto from 'crypto';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALGORITHM = 'aes-256-CBC';
const APP_SECRET = 'qacowork-secret-2024';
const SALT = 'qacowork-salt';
const ITERATIONS = 100000;

function getMachineId() {
    try {
        const interfaces = os.networkInterfaces();
        const macs = [];
        
        for (const name of Object.keys(interfaces)) {
            const nets = interfaces[name];
            if (nets) {
                for (const net of nets) {
                    if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                        macs.push(net.mac);
                    }
                }
            }
        }
        
        return macs.length > 0 ? macs[0] : os.hostname();
    } catch (error) {
        return os.hostname();
    }
}

function getMachineKey() {
    const machineId = getMachineId();
    const keyMaterial = machineId + APP_SECRET;
    return crypto.pbkdf2Sync(keyMaterial, SALT, ITERATIONS, 32, 'sha256');
}

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

console.log('='.repeat(60));
console.log('初始化预设配置');
console.log('='.repeat(60));
console.log();

const DEFAULT_MAX_TOKENS = 131072;

const defaultProviders = {
    'glm': {
        id: 'glm',
        name: '智谱 GLM',
        apiKey: '',
        apiUrl: 'https://open.bigmodel.cn/api/anthropic',
        model: 'glm-4.7',
        maxTokens: DEFAULT_MAX_TOKENS,
        readonlyUrl: true
    },
    'zai': {
        id: 'zai',
        name: 'ZAI (海外)',
        apiKey: '',
        apiUrl: 'https://api.z.ai/api/anthropic',
        model: 'glm-4.7',
        maxTokens: DEFAULT_MAX_TOKENS,
        readonlyUrl: true
    },
    'minimax_cn': {
        id: 'minimax_cn',
        name: 'MiniMax (国内)',
        apiKey: '',
        apiUrl: 'https://api.minimaxi.com/anthropic',
        model: 'MiniMax-M2.1',
        maxTokens: DEFAULT_MAX_TOKENS,
        readonlyUrl: true
    },
    'minimax_intl': {
        id: 'minimax_intl',
        name: 'MiniMax (海外)',
        apiKey: '',
        apiUrl: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M2.1',
        maxTokens: DEFAULT_MAX_TOKENS,
        readonlyUrl: true
    },
    'custom': {
        id: 'custom',
        name: '自定义',
        apiKey: 'ENCRYPTED:nYJ4xv9BnOan1KEHPuOd/g==:px8CE9CkPaWc2D5x7CX4S/a1VPnfjGLLYJ78rGTKDFZDCJ3zgJH4lqZDIiMbslDzD5kIew6HB4rGBq2MhCVufw==',
        apiUrl: 'https://newapi.waimai.st.sankuai.com',
        model: 'aws.claude-sonnet-4.5',
        maxTokens: 64000,
        isCustom: true,
        readonlyUrl: false,
        isPreset: true
    }
};

const defaults = {
    authorizedFolders: [],
    networkAccess: true,
    shortcut: 'Alt+Space',
    allowedPermissions: [],
    activeProviderId: 'custom',
    providers: defaultProviders,
    terminalMode: 'auto',
    chatEditorSplitRatio: 50
};

const store = new Store({
    name: 'qa-cowork-config',
    cwd: join(process.env.HOME, 'Library', 'Application Support', 'qacowork'),
    defaults: defaults
});

console.log('配置文件路径:', store.path);
console.log();

// Decrypt preset keys
const providers = store.get('providers') || defaultProviders;
let hasChanges = false;

for (const [id, provider] of Object.entries(providers)) {
    const defaultProvider = defaultProviders[id];
    if (defaultProvider?.isPreset) {
        if (!provider.isPreset) {
            provider.isPreset = true;
            hasChanges = true;
        }
    }

    if (provider.apiKey && provider.apiKey.startsWith('ENCRYPTED:')) {
        try {
            const encryptedData = provider.apiKey.substring(10);
            const decryptedKey = decryptApiKey(encryptedData);
            provider.apiKey = decryptedKey;
            provider.isPreset = true;
            hasChanges = true;
            console.log(`✅ 解密成功: ${id}`);
        } catch (error) {
            console.error(`❌ 解密失败: ${id}`, error.message);
        }
    }
}

if (hasChanges) {
    store.set('providers', providers);
    console.log('✅ 配置已保存');
}

console.log();
console.log('Custom 提供商配置:');
const customProvider = providers['custom'];
console.log('  API Key:', customProvider.apiKey ? `${customProvider.apiKey.substring(0, 10)}...` : '(empty)');
console.log('  isPreset:', customProvider.isPreset);
console.log();
console.log('🎉 初始化完成！');
