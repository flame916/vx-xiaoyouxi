# 理了个赔 · MVP 0.9c

纯静态、无需构建的 GitHub Pages 仓库：`docs/` 里是完整 0.9c 浏览器版。

## 线上

https://flame916.github.io/vx-xiaoyouxi/

## 发布方式

仓库 **Settings → Pages → Build and deployment**：
- Source：**Deploy from a branch**
- Branch：**main**
- 目录：**/docs**

没有 GitHub Actions 工作流；更新 `docs/` 后 Pages 自动重建。

## 本地预览

```powershell
python -m http.server 8021 --directory docs
# http://127.0.0.1:8021/
```

不要直接双击 `docs/index.html`；模块/JSON 需要 HTTP。

## 0.9c 内容

- 六险：车损/建工/财产/机器损坏/责任/船舶；购买价随波 2/3/4/5/6。
- 敌卡：客户/工地佬/船佬，小案/大案标签；Boss 4/5 波“大案来了”，船佬喊叫/工地佬砖块眩晕。
- 责任险：人伤绷带定身 800ms，客户 ×1.5。
- 已放置险种可拖回待启用栏；返利商店只结案后开放；无波次预告。

## 验证

- 04：0.9b 24/24（P0=0/P1=0/P2=2）；0.9c 19/19（P0=0/P1=0/P2=0）。
- 0.9c 46/46 哈希；0.9b 43/46（3 个=0.9c 改动）；0.9a/0.8a/0.7a/0.6 未变。
- D05：朴素 75HP/C、6×L1 第 4 波失守、优化 0 漏 S。

## 未测

真机触屏/iOS 安全区/字体、微信开发者工具/小游戏包、CDN/多地区、音效、真人平衡、Boss/绷带长期手感。不签微信/真机通过。

## 目录

- `docs/`：index.html、app.js、core.js、styles.css、insurance-config.json、assets/0.7 + 0.9 + 0.9b
- `README.md`：本文件
