# 理了个赔 · MVP 0.9a（GitHub Pages）

这是一个**纯静态、无需构建**的 GitHub Pages 仓库骨架：`docs/` 里是完整的 0.9a 浏览器版，`.github/workflows/pages.yml` 负责发布。

## 本地预览

```powershell
python -m http.server 8021 --directory docs
# http://127.0.0.1:8021/
```

不要直接双击 `docs/index.html`：模块和 JSON 需要 HTTP。

## 发布到 GitHub Pages

1. 仓库 Settings → Pages → Build and deployment → Source 选 **Deploy from a branch**。
2. Branch 选 **main**，目录选 **/docs**，Save。
3. 等 Pages 构建完，访问 `https://flame916.github.io/vx-xiaoyouxi/`。

本仓库已本地提交并推到 `flame916/vx-xiaoyouxi`；无 GitHub Actions 工作流，避免 OAuth App 的 workflow scope 限制。

## 版本与范围

- INS-MVP-0.9a：5 波、S/A/B/C 评级、首步教学、波次模糊提示、25 个原创 SVG、地图/特效深化。
- 浏览器基线：Chrome/Edge ≥123、Safari/iOS ≥17.2、Firefox ≥138（ES module + JSON import attributes）。
- 存档：localStorage + Web Locks，键 `ins-mvp-07-profile`；Pages 上是新源，首次打开会新建档，不会读取你本地 8020 的进度。
- 微信小游戏本轮不做：DOM/CSS 不能直接进小游戏，Canvas 端口另立任务。

## 验证

- 04 独立验收 179/179，P0=0/P1=0/P2=2；默认资源 5 波可通（S，0 漏）。
- 未测：真机触屏、iOS 安全区、字体回退、微信开发者工具、Pages 真实推送/CDN、旧浏览器、真人手感。

## 目录

- `docs/`：游戏静态文件（index.html、app.js、core.js、styles.css、insurance-config.json、assets/0.7）
- `.github/workflows/pages.yml`：Pages 发布
- `README.md`：本文件



