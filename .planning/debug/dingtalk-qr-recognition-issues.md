---
name: dingtalk-qr-recognition-issues
status: awaiting_human_verify
trigger: "用户反馈钉钉扫码有时候难以识别"
created: "2026-05-28"
updated: "2026-05-28"
symptoms:
  expected: "扫码后能快速识别并自动登录/跳转"
  actual: "有时能有时不能"
  reproduction: "PS插件内扫码"
  started: "有部分用户反馈不行"
Current Focus:
  hypothesis: null
  next_action: null
  test: null
  expecting: null
  reasoning_checkpoint: null
  tdd_checkpoint: null
---

## Current Focus

hypothesis: |
  QR码在PS插件UXP WebView中识别困难的根因是:
  1. QR码尺寸200px偏小, 在UXP WebView DPI缩放下模糊
  2. 容器无白色背景, 黑色QR码在深色背景上对比度低
  3. 纠错等级M(~15%)不足以应对扫描模糊
test: |
  检查CSS定义, 确认dingtalk-qr-container无样式; 检查QRCodeSVG参数
expecting: |
  发现无白色背景CSS, 尺寸200px, 纠错等级M
next_action: "等待用户在PS插件中验证修复效果"

## Symptoms
<!-- IMMUTABLE -->

expected: 扫码后能快速识别并自动登录/跳转
actual: 有时能有时不能
errors: []
reproduction: PS插件内扫码
started: 有部分用户反馈不行

## Eliminated
<!-- APPEND ONLY -->

## Evidence
<!-- APPEND ONLY -->

- timestamp: 2026-05-28
  checked: "DingTalkQRView.tsx"
  found: "QRCodeSVG value={authUrl} size={200} level='M'"
  implication: "尺寸200px, 纠错等级M(约15%容错), 在UXP WebView中可能因DPI缩放模糊"

- timestamp: 2026-05-28
  checked: "LoginModal.css"
  found: "无 .dingtalk-qr-container CSS定义"
  implication: "dingtalk-qr-container类未定义任何样式, 使用默认透明背景. QR码默认黑底黑字在暗色背景上对比度不足"

- timestamp: 2026-05-28
  checked: "DingTalkQRView.tsx 渲染逻辑"
  found: "QR码容器padding仅为8px, 且无显式background-color"
  implication: "容器没有白色衬底, QR码黑色模块与暗色背景对比度可能不足"

- timestamp: 2026-05-28
  checked: "qrcode.react 默认行为"
  found: "QRCodeSVG默认生成黑色QR码, 无背景色(透明)"
  implication: "黑色QR码在深色(--surface: #1e1e28)背景上打印出低对比度灰色调, 降低识别率"

## Resolution
<!-- OVERWRITE -->

root_cause: |
  1. QR码尺寸200px在UXP WebView中偏小, 且DPI缩放可能导致渲染模糊
  2. QR码容器(dingtalk-qr-container)无CSS定义, 缺少白色背景, 导致QR码与深色背景对比度不足
  3. 纠错等级M(~15%容错)可能不足以应对扫描时的轻微模糊/变形
fix: |
  1. 增大QR码尺寸到256px (28%增大)
  2. 提高纠错等级到H(最高30%容错, 比M提高一倍)
  3. 为QRCodeSVG添加bgColor="#ffffff"白色背景
  4. 为dingtalk-qr-container添加白色背景CSS样式
verification: "已在代码中实施, 待用户在PS插件中验证"
files_changed:
  - "code/webapp/src/components/DingTalkQRView.tsx"
  - "code/webapp/src/components/LoginModal.css"