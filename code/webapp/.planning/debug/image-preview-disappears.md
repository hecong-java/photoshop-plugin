---
status: resolved
trigger: "用户在PS插件中上传图片后，图片能短暂显示预览，但几秒后消失。图片已成功上传到ComfyUI目录（确认存在），但预览无法持久显示。此问题影响所有尺寸的图片，不限于大图。"
created: 2026-04-08T10:30:00.000Z
updated: 2026-04-08T11:00:00.000Z
---

## Root Cause

**React StrictMode 组件卸载时清理 Blob URLs 导致预览丢失**

### 问题代码位置
- **文件**: `src/pages/Draw.tsx`
- **行号**: 364-369 (原代码)

### 问题时序
1. 用户上传图片
2. 创建 blob URL 并设置预览状态 ✓
3. React StrictMode 触发组件 unmount → remount 循环
4. 清理函数运行，撤销所有 blob URLs ❌
5. 组件重新挂载，状态重置为空 `{}`
6. 图片预览消失 ❌

### 根本原因
React StrictMode 在开发模式下会双重挂载组件（mount → unmount → remount）。原来的清理函数在 unmount 时撤销了所有 blob URLs，导致重新挂载后预览无法显示。

## Fix Applied

### 修改 1: 添加状态恢复逻辑
**位置**: `src/pages/Draw.tsx` line 320-328

添加了 useEffect 在组件挂载时从 ref 恢复预览状态：
```typescript
// Restore image previews from ref on mount (handles React StrictMode remount)
useEffect(() => {
  const refPreviews = uploadedImagePreviewsRef.current;
  if (Object.keys(refPreviews).length > 0 && Object.keys(uploadedImagePreviews).length === 0) {
    console.log('[Draw] Restoring image previews from ref:', Object.keys(refPreviews));
    setUploadedImagePreviews(refPreviews);
  }
}, []);
```

### 修改 2: 移除卸载时清理 Blob URLs
**位置**: `src/pages/Draw.tsx` line 364-369

移除了在组件卸载时撤销 blob URLs 的代码，因为：
1. React StrictMode 会触发 unmount/remount 循环
2. 预览状态在重新挂载时从 ref 恢复
3. Blob URLs 只在切换工作流或明确移除图片时清理

## Verification

1. 在 PS 插件中上传图片
2. 观察预览是否持久显示
3. 切换工作流后预览应正确清除
4. 重新选择图片应正常更新预览

## Files Changed

- `src/pages/Draw.tsx` (2 处修改)
