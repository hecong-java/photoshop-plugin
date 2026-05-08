# Phase 07: DingTalk Auth Integration - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

在 Photoshop 插件（UXP WebView 环境）中接入钉钉 OAuth 授权登录，与现有的用户名/密码登录共存。插件复用 LemonGrid 后端已有的钉钉 OAuth 基础设施，适配 UXP 环境的特殊限制（无法使用标准 redirect OAuth）。

**In scope:**
- LoginModal 新增钉钉扫码登录入口（iframe 加载钉钉扫码页）
- 插件侧钉钉 OAuth 流程（获取授权 URL → iframe 展示二维码 → 轮询获取 JWT）
- OAuth 用户 token 刷新策略（refresh 过期后弹窗重新扫码）
- lemongridStore 新增 authProvider 字段
- 后端新增 poll 端点 + 修改 callback 存储 JWT 到 Redis
- 浏览器模式与 UXP 模式双模式自适应
- Settings 页显示登录方式

**Out of scope:**
- 钉钉绑定/解绑管理（在 LemonGrid Web 管理后台完成）
- 钉钉头像展示（复用现有用户信息 UI）
- 首次使用引导
- 钉钉侧会话清理

</domain>

<decisions>
## Implementation Decisions

### OAuth Flow Architecture
- **D-01:** 插件内通过 iframe 加载钉钉扫码登录页 (`https://login.dingtalk.com/login/qrcode.htm?appid=xxx&redirect_uri=xxx`)，用户用钉钉 app 扫码授权
- **D-02:** 钉钉回调到后端（不是插件），后端处理 authCode 换 JWT 并将结果存入 Redis（以 state 为 key）
- **D-03:** 插件轮询后端 poll 端点获取 JWT：`GET /api/v1/auth/dingtalk/poll?state=xxx`
- **D-04:** **风险缓解：** 实现时先验证 UXP WebView 是否允许跨域 iframe 加载钉钉域名。如果 iframe 被阻止，回退到"自生成 URL 二维码"方案（用 qrcode.react 将 OAuth URL 编码为二维码图片，用户用手机相机扫码打开浏览器完成授权）
- **D-05:** iframe 网络请求由 UXP WebView 直接加载（不经过 Bridge 代理），钉钉页面通过 HTTPS

### Login UI
- **D-06:** 复用现有 LoginModal，密码表单下方加分隔线"— 或 —"，再显示"钉钉扫码登录"按钮（蓝色、带钉钉图标）
- **D-07:** 点击钉钉按钮后，密码表单替换为 iframe 二维码视图。二维码视图顶部有"返回密码登录"链接
- **D-08:** 新用户首次登录直接显示完整 LoginModal（密码表单 + 钉钉按钮），不额外引导

### iframe & Polling Details
- **D-09:** iframe 宽度 100%，高度约 320px（钉钉扫码页最小尺寸）
- **D-10:** 二维码约 3 分钟过期后自动刷新 iframe（重新加载钉钉扫码页）
- **D-11:** 轮询间隔 2 秒，总超时 5 分钟
- **D-12:** 轮询超时后显示"二维码已过期，点击刷新"提示

### Token Lifecycle
- **D-13:** lemongridStore 新增 `authProvider: 'password' | 'dingtalk' | null` 字段
- **D-14:** OAuth 用户 refresh token 过期后，自动弹出 LoginModal 并切换到二维码视图（而不是密码表单），用户重新扫码即可
- **D-15:** `ensureValidToken()` 根据 authProvider 决定回退行为：password 用户尝试 re-login，dingtalk 用户弹出二维码视图
- **D-16:** 登出时仅清理本地状态（JWT、token、用户信息），不清理钉钉侧会话

### Backend Changes
- **D-17:** 新增端点 `GET /api/v1/auth/dingtalk/poll?state=xxx` — 返回 pending/completed/error 状态，completed 时返回 JWT token
- **D-18:** 修改 `POST /api/v1/auth/dingtalk/callback` — 处理完 authCode 后将 JWT 结果存入 Redis（key: `dingtalk:poll:{state}`，TTL 5 分钟），同时支持原有的 Web redirect 行为
- **D-19:** `GET /api/v1/auth/dingtalk/login-url` 需支持 `redirect_mode` 参数：`redirect`（Web 标准）和 `poll`（插件轮询模式），决定 callback 的行为

### Browser Compatibility
- **D-20:** 双模式自适应：浏览器模式（`isUXPWebView() === false`）使用标准 redirect OAuth 流程（复用 LemonGrid Web 已有的 redirect flow），UXP 模式使用 iframe + 轮询
- **D-21:** 浏览器模式下的钉钉登录不经过 Bridge，直接使用浏览器原生 fetch 和 window.location

### User Info & Settings
- **D-22:** 钉钉用户登录后复用现有用户信息展示（用户名 + 角色），后端返回的 display_name 存为 username
- **D-23:** Settings 页显示当前登录方式（"密码登录" 或 "钉钉登录"），仅展示不提供解绑功能
- **D-24:** 切换到 Cluster Mode 时智能弹窗：如果 authProvider 为 dingtalk 且 token 过期，自动显示二维码视图（不是密码表单）

### Error Handling
- **D-25:** 钉钉服务不可用 → "钉钉服务暂不可用，请稍后重试"
- **D-26:** 用户取消授权 → "授权已取消"
- **D-27:** 网络中断 → "网络连接失败" + 重试按钮
- **D-28:** 轮询超时 → "登录超时，请重试"
- **D-29:** 所有错误在二维码视图内显示，提供重试按钮，不自动切回密码表单

### Claude's Discretion
- iframe 加载状态动画（spinner）的样式
- 钉钉按钮的具体样式（颜色 #0089FF、图标来源）
- 轮询请求的取消逻辑（组件卸载时清理）
- Redis 中 poll 数据的具体 TTL 和清理策略
- 二维码自动刷新的定时器实现

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plugin Auth System (Must Read)
- `code/webapp/src/components/LoginModal.tsx` — 现有登录 UI，钉钉按钮和二维码视图的集成点
- `code/webapp/src/services/lemongrid-auth.ts` — Auth 服务层，新增 OAuth 函数的位置
- `code/webapp/src/stores/lemongridStore.ts` — Auth 状态管理，新增 authProvider 字段
- `code/webapp/src/pages/Settings.tsx` — 设置页，显示登录方式
- `PS-plugin/ningleai/main.js` — Bridge handlers，验证 iframe 加载限制

### LemonGrid Backend DingTalk Auth (Must Read)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\auth.py` — 钉钉 OAuth 端点（login-url, callback, bind-url, unbind）
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\dingtalk_service.py` — 钉钉 API 调用、用户匹配逻辑
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\core\config.py` — 钉钉配置（APP_KEY, APP_SECRET, REDIRECT_URI）
- `D:\projects\LemonGrid\LemonGrid\fluxcore-frontend\src\pages\auth\DingTalkCallback.tsx` — Web 端钉钉回调处理（参考实现）

### Prior Phase Context
- `.planning/phases/06-lemongrid-integration/06-CONTEXT.md` — Phase 06 完整决策（JWT auth, Bridge proxy, token lifecycle, lemongridStore）

### Architecture
- `.planning/codebase/ARCHITECTURE.md` — Bridge 通信模式，UXP WebView 架构

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `LoginModal` (LoginModal.tsx) — 现有登录弹窗，新增钉钉入口。表单提交逻辑、错误处理、loading 状态可复用
- `lemongridFetch` (lemongrid-auth.ts) — UXP/browser 自适应 fetch，新增的 OAuth API 调用复用此函数
- `loginToLemonGrid` (lemongrid-auth.ts) — 登录成功后的 store 更新模式（setAuth, syncAuthToBridge, getUserProfile）
- `ensureValidToken` (lemongrid-auth.ts) — Token 刷新逻辑，需扩展 OAuth 用户回退行为
- `syncAuthToBridge` (lemongrid-auth.ts) — JWT 同步到 Bridge，OAuth 登录成功后同样调用
- `isUXPWebView()` (upload.ts) — 环境检测，决定 OAuth 流程模式（iframe+polling vs redirect）
- `lemongridStore` (lemongridStore.ts) — Zustand persist store，新增 authProvider 字段

### Established Patterns
- Bridge message protocol: UUID-based request/response with timeout
- Auth flow: login → setAuth → syncAuthToBridge → getUserProfile → setConnected
- Token lifecycle: check validity → try refresh → re-login → show login modal
- LoginModal pattern: modal overlay → form → loading state → error display → success callback
- Environment branching: `isUXPWebView()` 决定 UXP Bridge path vs browser direct path

### Integration Points
- `LoginModal.tsx` — 新增"钉钉扫码登录"按钮 + 二维码视图（iframe）
- `lemongrid-auth.ts` — 新增 `getDingTalkLoginUrl()`, `pollDingTalkAuth()`, `loginWithDingTalk()`
- `lemongridStore.ts` — 新增 `authProvider` 字段 + `setAuthProvider()` action
- `Settings.tsx` — 显示当前登录方式
- LemonGrid backend `auth.py` — 新增 `poll` 端点 + 修改 `callback` 端点
- LemonGrid backend `dingtalk_service.py` — 可能需要适配 poll 模式

</code_context>

<specifics>
## Specific Ideas

- 钉钉扫码登录按钮使用钉钉品牌色 #0089FF，带钉钉 logo 图标
- iframe 回退方案：如果跨域 iframe 不可用，使用 qrcode.react 库将 OAuth URL 编码为二维码图片
- 浏览器模式直接复用 LemonGrid Web 前端的 redirect flow（`DingTalkCallback.tsx` 的逻辑）
- 二维码自动刷新通过重新设置 iframe src 或重新加载钉钉扫码页实现
- poll 端点返回格式：`{ status: "pending" | "completed" | "error", data?: { access_token, user }, error?: string }`

</specifics>

<deferred>
## Deferred Ideas

- 钉钉绑定/解绑管理 — 在 LemonGrid Web 管理后台完成，插件不提供此功能
- 钉钉头像展示 — 复用现有用户信息 UI，不单独展示钉钉头像
- 首次使用引导 — 直接显示完整 LoginModal，不额外引导
- 钉钉侧会话清理 — 登出仅清理本地状态
- 多钉钉应用/租户支持 — 当前仅支持单一钉钉应用配置
- 延长 refresh token 有效期 — 当前方案足够，如需延长由后端配置调整

</deferred>

---

*Phase: 07-dingtalk-auth*
*Context gathered: 2026-05-08*
