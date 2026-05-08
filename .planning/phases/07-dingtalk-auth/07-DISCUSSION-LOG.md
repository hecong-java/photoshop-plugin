# Phase 07: DingTalk Auth Integration - Discussion Log

**Date:** 2026-05-08

---

## Gray Areas Discussed

### 1. UXP OAuth Flow

**Question:** 插件无法处理 OAuth redirect，如何完成钉钉授权？

**Options presented:**
- 外部浏览器 + 轮询（通过 Bridge shell.openPath 打开浏览器，插件轮询后端）
- 插件内展示二维码（iframe 加载钉钉扫码页）
- Device Code 流程（用户手动输入验证码）

**Selection:** 插件内展示二维码

---

### 2. QR Code Implementation

**Question:** 插件内如何渲染钉钉扫码二维码？

**Options presented:**
- iframe 加载钉钉扫码页 `https://login.dingtalk.com/login/qrcode.htm`（Recommended）
- 自生成 URL 二维码（qrcode.react）
- 钉钉 JS SDK (ddlogin.js)

**Selection:** iframe 加载钉钉扫码页

---

### 3. Login UX Layout

**Question:** 钉钉扫码登录的 UI 如何与现有 LoginModal 共存？

**Options presented:**
- 复用 LoginModal（内部切换视图）（Recommended）
- 独立弹窗

**Selection:** 复用 LoginModal

---

### 4. Token Refresh Strategy

**Question:** 钉钉用户的 refresh token 也过期后，如何重新认证？

**Options presented:**
- 弹窗重新扫码（Recommended）
- 延长 refresh token 有效期
- 静默重新授权

**Selection:** 弹窗重新扫码

---

### 5. Backend Endpoints

**Question:** 后端如何支持插件的轮询式 OAuth？

**Options presented:**
- 新增 poll 端点 + 修改 callback（Recommended）
- 不改后端，用现有端点间接检测
- 新增完整的插件认证流程

**Selection:** 新增 poll 端点 + 修改 callback

---

### 6. iframe + Polling Details

**Question:** 二维码过期和轮询间隔如何处理？

**Options presented:**
- 自动刷新 + 2s 轮询（Recommended）
- 手动刷新 + 3s 轮询

**Selection:** 自动刷新 + 2s 轮询

---

### 7. Login Method Switch UX

**Question:** LoginModal 内密码登录和钉钉登录如何布局？

**Options presented:**
- 分隔线 + 钉钉按钮（Recommended）
- Tab 切换
- 仅钉钉登录

**Selection:** 分隔线 + 钉钉按钮

---

### 8. Browser Compatibility

**Question:** 浏览器开发模式下钉钉登录如何处理？

**Options presented:**
- 双模式自适应（浏览器 redirect / UXP iframe+polling）（Recommended）
- 仅 UXP 环境支持
- 统一 iframe 方案

**Selection:** 双模式自适应

---

### 9. Binding Management

**Question:** 插件内是否需要管理钉钉绑定状态？

**Options presented:**
- 仅显示登录方式（Recommended）
- 插件内绑定/解绑

**Selection:** 仅显示登录方式

---

### 10. iframe Cross-Origin Feasibility

**Question:** 如果 UXP WebView 不支持跨域 iframe，怎么处理？

**Options presented:**
- 先验证 + 回退方案（Recommended）
- 直接用自生成二维码
- 实现时决定

**Selection:** 先验证 + 回退方案

---

### 11. Error Handling

**Question:** 钉钉扫码过程中的错误如何处理？

**Options presented:**
- 视图内错误提示 + 重试（Recommended）
- 错误后回到密码表单

**Selection:** 视图内错误提示 + 重试

---

### 12. Auto-Login Strategy

**Question:** 切换到 Cluster Mode 时的自动登录策略？

**Options presented:**
- 智能弹窗（根据 authProvider 决定默认视图）（Recommended）
- 总是显示选择界面

**Selection:** 智能弹窗

---

### 13. First-Time User

**Question:** 新用户首次登录时是否需要引导？

**Options presented:**
- 直接显示登录弹窗（Recommended）
- 高亮提示钉钉登录

**Selection:** 直接显示登录弹窗

---

### 14. DingTalk User Info

**Question:** 钉钉用户登录后展示哪些信息？

**Options presented:**
- 复用现有展示（Recommended）
- 展示钉钉头像和昵称

**Selection:** 复用现有展示

---

### 15. Logout Cleanup

**Question:** 登出时是否需要清理钉钉侧会话？

**Options presented:**
- 仅清理本地状态（Recommended）
- 同时清理钉钉会话

**Selection:** 仅清理本地状态

---

### 16. iframe Network Path

**Question:** iframe 的网络请求如何处理？

**Options presented:**
- 直接加载（Recommended）
- Bridge 代理加载

**Selection:** 直接加载

---

## Summary

- **Total decisions:** 16 (D-01 through D-25 in CONTEXT.md, some grouped)
- **Key architectural decision:** iframe 加载钉钉扫码页 + 轮询后端获取 JWT
- **Risk identified:** UXP WebView 跨域 iframe 可行性，需先验证并准备回退方案
- **Backend changes required:** 新增 poll 端点 + 修改 callback 存储 JWT 到 Redis

---

*Discussion log generated: 2026-05-08*
