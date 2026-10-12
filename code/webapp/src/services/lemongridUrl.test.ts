/**
 * LemonGrid 服务器地址配置回归锁（2026-10-12 预览裂图事故）。
 *
 * 事故：LEMONGRID_PRIMARY_URL 原为 'http://www.lemongrid.cn'（http 明文 + www 子域）。
 * 面板 WebView 页面从 https://lemongrid.cn/ps/ 加载，<img src="http://www...">
 * 触发混合内容拦截 —— UXP WebView 直接不发请求，上传参考图后预览永远裂图
 * （上传走宿主 bridge 不受页面混合内容策略约束，所以"上传成功但预览裂"）。
 *
 * 两把锁：
 * 1. PRIMARY_URL 必须是 https 裸域 —— 明文 http 在 https 页面内必被拦；
 * 2. setUserProvidedUrl 必须清 lockedUrl —— 否则用户改了服务器地址后当前会话
 *    仍路由到启动时锁定的旧地址（用户实测：改完配置不重启不生效）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  LEMONGRID_PRIMARY_URL,
  setUserProvidedUrl,
  getUserProvidedUrl,
  setLockedUrl,
  getLockedUrl,
  getEffectiveCandidates,
  clearUserProvidedUrl,
} from './lemongrid-url'

describe('lemongrid-url 服务器地址配置', () => {
  it('PRIMARY_URL 必须是 https 裸域（http 明文在 https 页面触发混合内容拦截 → 预览裂图）', () => {
    expect(LEMONGRID_PRIMARY_URL).toBe('https://lemongrid.cn')
    expect(LEMONGRID_PRIMARY_URL.startsWith('https://')).toBe(true)
    expect(LEMONGRID_PRIMARY_URL.replace('https://', '')).not.toContain('www.')
  })

  it('setUserProvidedUrl 必须清 lockedUrl（改配置立即生效，无需重启面板）', () => {
    setLockedUrl('http://www.lemongrid.cn') // 模拟启动时锁定的旧地址
    setUserProvidedUrl('https://lemongrid.cn')
    expect(getLockedUrl()).toBeNull()
    expect(getUserProvidedUrl()).toBe('https://lemongrid.cn')
  })

  it('setUserProvidedUrl(null)（清除用户配置）同样清 lockedUrl', () => {
    setLockedUrl('https://lemongrid.cn')
    setUserProvidedUrl(null)
    expect(getLockedUrl()).toBeNull()
    expect(getUserProvidedUrl()).toBeNull()
  })

  it('用户配置地址在候选列表中优先于 PRIMARY', () => {
    setUserProvidedUrl('https://custom.example.com')
    const candidates = getEffectiveCandidates()
    expect(candidates[0]).toBe('https://custom.example.com')
    expect(candidates[1]).toBe('https://lemongrid.cn')
    // 清理
    clearUserProvidedUrl()
  })
})
