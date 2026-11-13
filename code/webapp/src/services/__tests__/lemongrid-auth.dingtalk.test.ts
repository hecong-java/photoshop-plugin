import { beforeEach, describe, expect, it, vi } from 'vitest';

// lemongrid-auth 顶层 import 了 upload / lemongrid-url / lemongridStore。
// 浏览器模式（isUXPWebView=false）走 doBrowserFetch → 全局 fetch，
// 所以这里把 UXP 探测关掉、failover 直通（固定 base），再用可注入的
// global.fetch 记录请求 URL。注意：vi.mock 路径相对本测试文件解析，
// __tests__/ 下指向上级 services 目录用 '../'，store 在 src/stores 用 '../../'。
vi.mock('../upload', () => ({
  isUXPWebView: () => false,
  hasBridgeTransport: () => false,
  sendBridgeMessage: vi.fn(),
}));

// failover 直通：固定 base（字面量，工厂不能引用被提升后才初始化的顶层变量）
const FAILOVER_BASE = 'http://test.local';

vi.mock('../lemongrid-url', () => {
  const base = 'http://test.local';
  return {
    LEMONGRID_PRIMARY_URL: base,
    withUrlFailoverResponse: (doFetch: (url: string) => Promise<Response>) =>
      doFetch(base),
    withUrlFailover: (doFetch: (url: string) => Promise<unknown>) =>
      doFetch(base),
    // dev 代理地址重写：非 lemongrid.cn 域名原样返回（测试里都是 test.local）
    resolveRequestBase: (url: string) => url,
  };
});

vi.mock('../../stores/lemongridStore', () => ({
  useLemonGridStore: {
    getState: () => ({ accessToken: undefined }),
  },
}));

import { getDingTalkLoginUrl, getDingTalkOrgs } from '../lemongrid-auth';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let requestedUrls: string[] = [];

beforeEach(() => {
  requestedUrls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return Promise.resolve(jsonResponse({ ok: true }));
    })
  );
});

describe('getDingTalkLoginUrl', () => {
  it('不带 orgCode 时请求保持原样（兼容单组织/老后端）', async () => {
    await getDingTalkLoginUrl(`${FAILOVER_BASE}/`, 'poll');

    expect(requestedUrls).toEqual([
      `${FAILOVER_BASE}/api/v1/auth/dingtalk/login-url?redirect_mode=poll`,
    ]);
  });

  it('带 orgCode 时追加 org_code 查询参数', async () => {
    await getDingTalkLoginUrl(FAILOVER_BASE, 'poll', 'ninele');

    expect(requestedUrls).toEqual([
      `${FAILOVER_BASE}/api/v1/auth/dingtalk/login-url?redirect_mode=poll&org_code=ninele`,
    ]);
  });

  it('orgCode 需要编码', async () => {
    await getDingTalkLoginUrl(FAILOVER_BASE, 'redirect', 'a b&c');

    expect(requestedUrls[0]).toContain('org_code=a%20b%26c');
  });
});

describe('getDingTalkOrgs', () => {
  it('返回组织列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          jsonResponse([
            { org_code: 'ninele', name: '湖南柠乐品牌管理有限公司' },
            { org_code: 'ninemei', name: '湖南柠美科技有限公司' },
          ])
        );
      })
    );

    const orgs = await getDingTalkOrgs(FAILOVER_BASE);

    expect(requestedUrls).toEqual([`${FAILOVER_BASE}/api/v1/auth/dingtalk/orgs`]);
    expect(orgs).toEqual([
      { org_code: 'ninele', name: '湖南柠乐品牌管理有限公司' },
      { org_code: 'ninemei', name: '湖南柠美科技有限公司' },
    ]);
  });

  it('404（老后端无组织接口）时返回空数组，调用方按不选组织处理', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ detail: 'Not Found' }, 404)))
    );

    const orgs = await getDingTalkOrgs(FAILOVER_BASE);

    expect(orgs).toEqual([]);
  });
});
