/**
 * SSO 单点登录初始化模块
 *
 * 使用 @mtfe/sso-web-oidc OIDC 协议 Web SDK 实现扫码登录。
 * 回调地址固定为 <当前域名>/websso/oauth/callback（由 SDK 自动处理）。
 *
 * 本地开发：/websso/ 由 vite.config.ts 中的 proxy 转发到测试 SSO 服务。
 * 线上/测试环境：需在 Oceanus 配置 /websso/ 路径映射到 com.sankuai.sso.webauth。
 */

// @mtfe/sso-web-oidc 通过 CDN UMD 方式引入（见 index.html），
// 此处声明全局变量类型以供 TypeScript 使用。
declare global {
  interface Window {
    SSOWeb?: {
      login(config: SSOWebLoginConfig): Promise<string | undefined>;
      logout(): void;
      whoami(): Promise<SSOWhoamiResult>;
    };
    SSOWebClient?: new (config: SSOWebLoginConfig) => {
      login(): Promise<string | undefined>;
      logout(): void;
      whoami(): Promise<SSOWhoamiResult>;
    };
  }
}

interface SSOWebLoginConfig {
  clientId: string;
  accessEnv: 'product' | 'test';
}

interface SSOWhoamiResult {
  code: number;
  data?: {
    name?: string;
    subject?: string;
    mtEmpId?: number;
    [key: string]: unknown;
  };
}

const SSO_CLIENT_ID = 'b44f54ea66';
const SSO_ENV: 'product' | 'test' = (
  window.location.hostname.includes('.test.') ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? 'test' : 'product';

const SSO_CONFIG: SSOWebLoginConfig = {
  clientId: SSO_CLIENT_ID,
  accessEnv: SSO_ENV,
};

/**
 * 初始化 SSO 登录。
 * 未登录时自动跳转扫码页；已登录直接返回 accessToken。
 * 在 src/main.tsx 的应用入口处调用一次即可。
 */
export const initSSO = async (): Promise<string | undefined> => {
  const ssoWeb = window.SSOWeb;
  if (!ssoWeb) {
    console.error('[SSO] SSOWeb SDK 未加载，请检查 index.html 中的 CDN 引入');
    return undefined;
  }
  try {
    const accessToken = await ssoWeb.login(SSO_CONFIG);
    return accessToken;
  } catch (err) {
    console.error('[SSO] 登录失败:', err);
    return undefined;
  }
};

/** 登出当前用户 */
export const logoutSSO = (): void => {
  window.SSOWeb?.logout();
};

/** 获取当前登录用户信息 */
export const getSSOUserInfo = async (): Promise<SSOWhoamiResult['data'] | null> => {
  const ssoWeb = window.SSOWeb;
  if (!ssoWeb) return null;
  try {
    const result = await ssoWeb.whoami();
    return result?.code === 0 ? (result.data ?? null) : null;
  } catch {
    return null;
  }
};
