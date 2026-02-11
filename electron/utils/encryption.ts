import crypto from 'crypto';
import os from 'os';

/**
 * 加密工具模块
 * 用于加密和解密 API 密钥，确保密钥在代码中以加密形式存储
 */

const ALGORITHM = 'aes-256-cbc';
const APP_SECRET = 'qacowork-secret-2024'; // 应用固定盐值
const SALT = 'qacowork-salt';
const ITERATIONS = 100000;

/**
 * 获取机器唯一标识
 * 基于网络接口的 MAC 地址生成
 */
function getMachineId(): string {
    try {
        const interfaces = os.networkInterfaces();
        const macs: string[] = [];
        
        for (const name of Object.keys(interfaces)) {
            const nets = interfaces[name];
            if (nets) {
                for (const net of nets) {
                    // 跳过内部和非物理接口
                    if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
                        macs.push(net.mac);
                    }
                }
            }
        }
        
        // 使用第一个有效的 MAC 地址，如果没有则使用主机名
        return macs.length > 0 ? macs[0] : os.hostname();
    } catch (error) {
        console.error('[Encryption] Failed to get machine ID:', error);
        // 回退到主机名
        return os.hostname();
    }
}

/**
 * 生成加密密钥
 * 基于机器 ID 和应用密钥派生
 */
function getMachineKey(): Buffer {
    const machineId = getMachineId();
    const keyMaterial = machineId + APP_SECRET;
    
    // 使用 PBKDF2 派生密钥
    return crypto.pbkdf2Sync(keyMaterial, SALT, ITERATIONS, 32, 'sha256');
}

/**
 * 加密 API 密钥
 * @param plaintext 明文 API 密钥
 * @returns 加密后的字符串（格式：iv:encrypted）
 */
export function encryptApiKey(plaintext: string): string {
    try {
        const key = getMachineKey();
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        
        // 返回格式：iv:encrypted（都是 base64 编码）
        return iv.toString('base64') + ':' + encrypted;
    } catch (error) {
        console.error('[Encryption] Failed to encrypt API key:', error);
        throw new Error('Failed to encrypt API key');
    }
}

/**
 * 解密 API 密钥
 * @param encrypted 加密的字符串（格式：iv:encrypted）
 * @returns 解密后的明文 API 密钥
 */
export function decryptApiKey(encrypted: string): string {
    try {
        const key = getMachineKey();
        
        // 分离 IV 和加密数据
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
        console.error('[Encryption] Failed to decrypt API key:', error);
        throw new Error('Failed to decrypt API key');
    }
}

/**
 * 检查字符串是否为加密格式
 * @param value 要检查的字符串
 * @returns 是否为加密格式
 */
export function isEncrypted(value: string): boolean {
    return value.startsWith('ENCRYPTED:');
}

/**
 * 从加密字符串中提取加密数据
 * @param value 完整的加密字符串（ENCRYPTED:...）
 * @returns 纯加密数据（去掉前缀）
 */
export function extractEncryptedData(value: string): string {
    if (!isEncrypted(value)) {
        throw new Error('Not an encrypted value');
    }
    return value.substring(10); // 去掉 "ENCRYPTED:" 前缀
}

/**
 * 掩码显示 API 密钥
 * @param key API 密钥
 * @returns 掩码后的字符串（如：sk-***...***B58）
 */
export function maskApiKey(key: string): string {
    if (!key || key.length < 10) {
        return '***';
    }
    const start = key.substring(0, 3);
    const end = key.substring(key.length - 4);
    return `${start}***...***${end}`;
}
