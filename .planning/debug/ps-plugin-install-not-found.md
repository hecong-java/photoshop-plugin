---
status: resolved
trigger: "有用户反馈正版PS无法安装插件"
created: "2026-05-26"
updated: "2026-05-26"
---

# Debug: PS Plugin Install Not Found

## Symptoms

- **Expected behavior:** 用户运行 install.bat 安装插件，期望在 Photoshop 中看到插件
- **Actual behavior:** 安装过程无报错，但 PS 中找不到插件
- **PS version:** Creative Cloud 订阅版（正版）
- **Timeline:** 不确定是否曾经正常工作过
- **Error messages:** 暂无具体错误信息或截图
- **Reproduction:** 在 Creative Cloud 订阅版 PS 上运行 install.bat

## Current Focus

- **hypothesis:** CONFIRMED AND FIXED
- **test:** Code analysis and file verification
- **expecting:** Plugin loads correctly after fix
- **next_action:** User verification on affected machine
- **reasoning_checkpoint:**

## Evidence

- 2026-05-26: install.bat queries `HKLM\SOFTWARE\Adobe\Photoshop` for PluginPath. The for loop took the FIRST subkey with PluginPath. On multi-version installs, the first subkey may lack PluginPath, leaving `plugin_folder` empty.
- 2026-05-26: manifest.json references `icons/logo.png` but only `logo@1x.png` and `logo@2x.png` existed. UXP silently fails to load plugin when icon paths are missing.
- 2026-05-26: install.bat used relative path `lemongrid` without CWD validation. Running from Explorer "Run as Admin" may use System32 as CWD.

## Eliminated

- UXP ExternalPlugins path is correct (`%APPDATA%\Adobe\UXP\Plugins\External\lemongrid`)
- manifest.json manifestVersion 5 and host minVersion 24.1.0 are valid for modern PS
- webview permissions in manifest look correct

## Resolution

- **root_cause:** (1) `icons/logo.png` referenced in manifest.json did not exist — UXP silently fails to load plugin panel. (2) install.bat registry query took first subkey with PluginPath; on multi-version installs this could be empty. (3) No CWD validation in install.bat.
- **fix:** (1) Copied `logo@1x.png` to `logo.png` — UXP expects `logo.png` (1x) and `logo@2x.png` (2x). (2) Rewrote install.bat registry loop to process ALL subkeys (last valid PluginPath wins = latest version). (3) Added `cd /d "%~dp0"` for CWD and source folder existence check. (4) Added skip logic when `plugin_folder` is empty (still copies to UXP path). (5) Added clear "Please restart Photoshop" message.
- **verification:** Verified `logo.png` exists in `icons/`. install.bat reviewed for correctness. Pending user verification on affected machine.
- **files_changed:** PS-plugin/lemongrid/icons/logo.png (created), PS-plugin/install.bat (rewritten)
