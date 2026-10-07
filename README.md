# LemonGrid PS 插件

## 结构（一句话）

`PS-plugin/lemongrid/` 是装进 Photoshop 的 UXP 壳（一个 webview），页面内容来自 `code/webapp`（React + Vite）构建后部署的网址；API 调线上后端 `www.lemongrid.cn`，本地开发不需要起后端。

## 本地开发（两步）

1. **双击 `start-dev.bat`** —— 启动本地服务，页面地址 `http://localhost:5173/ps/`
2. **执行 `switch-url.bat dev`** —— 把插件壳指向本地地址，然后重启 PS

调试完切回线上：

```
switch-url.bat prod
```

查看当前指向：

```
switch-url.bat status
```

## 地址切换规范（防事故，必读）

- 插件壳的地址**只有一处**：`PS-plugin/lemongrid/index.html` 的 webview `src`
- main.js 的来源白名单会**自动跟随**这个 src，切换后无需改其他任何文件
- **禁止手改地址**，统一用 `switch-url.bat dev | prod | status`
- **提交代码 / 打包发布前，必须 `switch-url.bat status` 确认是线上地址**
- git 约定：仓库里永远保持线上地址；本地切到 dev 后，index.html 的改动**不要提交**
- 发布 webapp 用 `./deploy.sh`（构建 + 上传阿里云 jumpB，线上地址 https://lemongrid.cn/ps/）

> ⚠️ 2026-06-26 曾因同事本地 dev 地址误入发布包导致线上事故（git 提交 084a9de），以上规范就是防这个的。

## 安装插件

见 `PS-plugin/安装说明.txt`（.ccx 双击 / install.bat / 手动复制 三种方式，需 PS 2024 / 24.3+）
