import fs from 'fs';
import { directoryManager } from './DirectoryManager';
// @ts-ignore – @mtfe/sso-web-oidc-cli 是美团内部包，无类型声明
import { SSOCliClient, SSOAccessEnvType } from '@mtfe/sso-web-oidc-cli';

/**
 * 用户身份信息（对齐小美搭档 ~/.xiaomei-cowork-userinfo 格式）
 */
export interface UserInfo {
    introspectionResultEnum: string;
    scope: string;
    clientId: string;
    name: string;
    tokenType: string;
    expire: number;
    issuedAt: number;
    subject: string;
    audience: string[];
    issuer: string | null;
    jwtId: string | null;
    actor: string | null;
    mtSubjectType: string;
    mtEmpId: number;
    acr: string | null;
    amr: string | null;
    authTime: string | null;
    ssoid: string;
}

/**
 * SSO token 文件结构（对齐小美搭档 ~/.xiaomei-cowork-sso 格式）
 * 由 @mtfe/sso-web-oidc-cli SDK 自动写入
 */
export interface SsoToken {
    access_token: string;
    refresh_token: string;
    id_token: string | null;
    token_exchange_attestation: string | null;
    error: string | null;
    error_description: string | null;
    modified_at: number;
}

/**
 * 从 AT token 内嵌 payload 中解析过期时间（毫秒）
 * 小美搭档的 AT 格式：base64Part1**mtsso**sig**base64Payload
 * base64Payload 解码后为逗号分隔：empId,misid,name,email,1,xxx,expireMs,clientId,...
 */
function parseAtTokenExpMs(token: string): number | null {
    // 标准 JWT 格式（header.payload.signature）
    const jwtParts = token.split('.');
    if (jwtParts.length >= 2) {
        try {
            const normalized = jwtParts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
            const json = Buffer.from(padded, 'base64').toString('utf-8');
            const payload = JSON.parse(json) as { exp?: number };
            if (payload?.exp) return payload.exp * 1000;
        } catch {
            // not JWT
        }
    }

    // 美团 AT_xxx**mtsso**sig**base64Payload 格式
    const parts = token.split('**');
    if (parts.length >= 4) {
        try {
            const lastPart = parts[parts.length - 1];
            const decoded = Buffer.from(lastPart, 'base64').toString('utf-8');
            // 格式：empId,misid,name,email,1,xxx,expireMs,...
            const fields = decoded.split(',');
            // expireMs 在第 7 位（index 6）
            const expireMs = parseInt(fields[6], 10);
            if (!isNaN(expireMs) && expireMs > Date.now()) return expireMs;
        } catch {
            // ignore
        }
    }

    return null;
}

const TOKEN_EXPIRE_BUFFER = 60 * 60 * 1000;  // 提前 1 小时刷新
const TOKEN_MAX_AGE = 3 * 24 * 60 * 60 * 1000; // 3 天兜底（AT 无法解析时）

class SsoStore {
    private tokenPath: string;
    private userInfoPath: string;
    private cachedToken: SsoToken | null = null;
    private cachedUserInfo: UserInfo | null = null;
    private ssoClient: ReturnType<typeof this.createSsoClient>;
    private refreshPromise: Promise<boolean> | null = null;

    constructor() {
        this.tokenPath = directoryManager.getSsoTokenPath();
        this.userInfoPath = directoryManager.getUserInfoPath();
        this.ssoClient = this.createSsoClient();
    }

    private createSsoClient() {
        return new SSOCliClient({
            clientId: '12d702aa62',
            accessEnv: SSOAccessEnvType.product,
            localPortList: [9152, 10152],
            isDebug: false,
            tokenStorage: {
                get: async () => {
                    this.cachedToken = this.readToken();
                    return this.cachedToken || {};
                },
                set: async (token: SsoToken) => {
                    this.cachedToken = token;
                    this.writeToken(token);
                },
            },
        });
    }

    // ─── Token 读写 ────────────────────────────────────────────────────────────

    readToken(): SsoToken | null {
        try {
            if (!fs.existsSync(this.tokenPath)) return null;
            const raw = fs.readFileSync(this.tokenPath, 'utf-8').trim();
            if (!raw) return null;
            return JSON.parse(raw) as SsoToken;
        } catch (err) {
            console.error('[SsoStore] Failed to read token:', err);
            return null;
        }
    }

    writeToken(token: SsoToken): void {
        try {
            fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2), 'utf-8');
            console.log('[SsoStore] Token saved to:', this.tokenPath);
        } catch (err) {
            console.error('[SsoStore] Failed to write token:', err);
        }
    }

    clearToken(): void {
        try {
            if (fs.existsSync(this.tokenPath)) {
                fs.unlinkSync(this.tokenPath);
                this.cachedToken = null;
            }
        } catch (err) {
            console.error('[SsoStore] Failed to clear token:', err);
        }
    }

    // ─── UserInfo 读写 ─────────────────────────────────────────────────────────

    readUserInfo(): UserInfo | null {
        try {
            if (!fs.existsSync(this.userInfoPath)) return null;
            const raw = fs.readFileSync(this.userInfoPath, 'utf-8').trim();
            if (!raw) return null;
            return JSON.parse(raw) as UserInfo;
        } catch (err) {
            console.error('[SsoStore] Failed to read userinfo:', err);
            return null;
        }
    }

    writeUserInfo(info: UserInfo): void {
        try {
            fs.writeFileSync(this.userInfoPath, JSON.stringify(info, null, 2), 'utf-8');
            console.log('[SsoStore] UserInfo saved to:', this.userInfoPath);
        } catch (err) {
            console.error('[SsoStore] Failed to write userinfo:', err);
        }
    }

    clearUserInfo(): void {
        try {
            if (fs.existsSync(this.userInfoPath)) {
                fs.unlinkSync(this.userInfoPath);
                this.cachedUserInfo = null;
            }
        } catch (err) {
            console.error('[SsoStore] Failed to clear userinfo:', err);
        }
    }

    // ─── Token 有效性检测 ──────────────────────────────────────────────────────

    /**
     * 判断 access_token 是否有效且不需要立即刷新
     * 优先从 AT token 内嵌 payload 解析过期时间（精确），
     * 其次使用 token 文件修改时间 + 3 天兜底
     */
    isTokenValid(): boolean {
        const token = this.cachedToken ?? this.readToken();
        if (!token?.access_token || token.error) return false;

        const expMs = parseAtTokenExpMs(token.access_token);
        if (expMs) {
            return Date.now() < expMs - TOKEN_EXPIRE_BUFFER;
        }

        // 兜底：用文件修改时间 + 3 天
        const tokenAge = Date.now() - (token.modified_at || 0);
        return tokenAge < TOKEN_MAX_AGE - TOKEN_EXPIRE_BUFFER;
    }

    needsLogin(): boolean {
        const token = this.readToken();
        if (!token?.access_token) return true;
        if (token.error) return true;
        return false;
    }

    // ─── Token 自动刷新 ────────────────────────────────────────────────────────

    /**
     * 若 token 即将过期则通过 ssoClient 静默续期（使用 refresh_token）
     * 防止并发刷新
     */
    private async refreshTokenIfNeeded(): Promise<boolean> {
        if (this.isTokenValid()) return true;

        if (this.refreshPromise) return this.refreshPromise;

        this.refreshPromise = (async () => {
            try {
                console.log('[SsoStore] Refreshing token via ssoClient...');
                const newToken = await this.ssoClient.login();
                this.cachedToken = newToken;
                console.log('[SsoStore] Token refreshed successfully');
                return true;
            } catch (err) {
                console.error('[SsoStore] Token refresh failed:', err);
                return false;
            } finally {
                this.refreshPromise = null;
            }
        })();

        return this.refreshPromise;
    }

    // ─── 获取用户身份（whoami）────────────────────────────────────────────────

    /**
     * 从 SSO 服务获取当前用户信息，并缓存到本地 userinfo 文件
     * 若接口失败则回退到本地缓存
     */
    async fetchUserInfo(): Promise<UserInfo | null> {
        await this.refreshTokenIfNeeded();

        try {
            const result = await this.ssoClient.whoami() as {
                code: number;
                data?: Partial<UserInfo>;
            };
            if (result?.code === 0 && result.data) {
                const token = this.cachedToken ?? this.readToken();
                const userInfo: UserInfo = {
                    introspectionResultEnum: 'SUCCESS',
                    scope: 'profile',
                    clientId: result.data.clientId ?? '12d702aa62',
                    name: result.data.name ?? '',
                    tokenType: 'Bearer',
                    expire: result.data.expire ?? Math.floor((Date.now() + 3 * 24 * 3600 * 1000) / 1000),
                    issuedAt: result.data.issuedAt ?? Math.floor(Date.now() / 1000),
                    subject: result.data.subject ?? '',
                    audience: result.data.audience ?? [],
                    issuer: result.data.issuer ?? null,
                    jwtId: result.data.jwtId ?? null,
                    actor: result.data.actor ?? null,
                    mtSubjectType: result.data.mtSubjectType ?? 'ACCOUNT',
                    mtEmpId: result.data.mtEmpId ?? 0,
                    acr: result.data.acr ?? null,
                    amr: result.data.amr ?? null,
                    authTime: result.data.authTime ?? null,
                    ssoid: token?.access_token ?? '',
                };
                this.cachedUserInfo = userInfo;
                this.writeUserInfo(userInfo);
                return userInfo;
            }
        } catch (err) {
            console.warn('[SsoStore] whoami failed, falling back to cache:', err);
        }

        // 回退到本地缓存
        const cached = this.cachedUserInfo ?? this.readUserInfo();
        if (cached) {
            const token = this.cachedToken ?? this.readToken();
            return { ...cached, ssoid: token?.access_token ?? cached.ssoid };
        }

        return null;
    }

    // ─── 登录流程 ─────────────────────────────────────────────────────────────

    /**
     * 触发扫码登录：调用 @mtfe/sso-web-oidc-cli 的 login()，
     * SDK 会自动打开浏览器，启动本地回调服务器，完成 OIDC 授权码流程，
     * 并通过 tokenStorage.set 将 token 写入文件
     */
    async login(): Promise<SsoToken> {
        const token = await this.ssoClient.login() as SsoToken;
        this.cachedToken = token;
        return token;
    }

    // ─── 综合初始化 ───────────────────────────────────────────────────────────

    /**
     * 应用启动时调用：尝试从本地恢复登录态
     *
     * 优先级：
     * 1. 本地 token 有效（未过期）且有 userinfo → 直接恢复，零网络请求
     * 2. 本地 token 存在但即将过期 → 尝试 whoami 刷新 userinfo
     * 3. whoami 失败（内网不通）→ 降级使用本地缓存 userinfo（只要 token 未彻底过期）
     * 4. token 彻底过期或不存在 → 返回 null，需要重新登录
     */
    async tryRestoreSession(): Promise<{ token: SsoToken; userInfo: UserInfo } | null> {
        const token = this.readToken();
        if (!token?.access_token || token.error) {
            console.log('[SsoStore] No token found, login required');
            return null;
        }
        this.cachedToken = token;

        // 路径 1：token 有效 + 有 userinfo → 直接恢复
        if (this.isTokenValid()) {
            const userInfo = this.readUserInfo();
            if (userInfo) {
                console.log(`[SsoStore] Session restored for: ${userInfo.name} (${userInfo.subject})`);
                return { token, userInfo };
            }
        }

        // 路径 2：尝试 whoami 刷新 userinfo
        console.log('[SsoStore] Token exists, fetching userinfo via whoami...');
        const userInfo = await this.fetchUserInfo();
        if (userInfo) {
            const refreshedToken = this.cachedToken ?? token;
            console.log(`[SsoStore] Session refreshed for: ${userInfo.name} (${userInfo.subject})`);
            return { token: refreshedToken, userInfo };
        }

        // 路径 3：whoami 失败 → 降级使用本地缓存
        const cachedUserInfo = this.readUserInfo();
        if (cachedUserInfo) {
            const expMs = parseAtTokenExpMs(token.access_token);
            const hardDeadline = expMs ?? (token.modified_at + TOKEN_MAX_AGE);
            if (Date.now() < hardDeadline) {
                console.warn('[SsoStore] whoami failed, using cached userinfo (offline fallback)');
                return { token, userInfo: cachedUserInfo };
            }
        }

        console.warn('[SsoStore] Token expired and no cached userinfo, login required');
        return null;
    }

    /**
     * 获取当前 access_token（供 Agent 调用 SSO 保护接口时使用）
     */
    async getAccessToken(): Promise<string | null> {
        await this.refreshTokenIfNeeded();
        return this.cachedToken?.access_token ?? this.readToken()?.access_token ?? null;
    }

    /**
     * 登出：清除本地 token 和 userinfo
     */
    logout(): void {
        this.clearToken();
        this.clearUserInfo();
        console.log('[SsoStore] Logged out');
    }

    getConfig() {
        return { clientId: '12d702aa62' };
    }
}

export const ssoStore = new SsoStore();
