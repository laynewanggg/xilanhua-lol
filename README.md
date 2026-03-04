# LOL 10人内战阵容随机器

一个纯前端静态应用，用于在英雄联盟 10 人内战场景下，一键生成双方阵容。

## 功能

- 一键随机生成双方阵容（蓝色方/红色方）
- 按位置生成：上中下辅助打野
- 每轮保证 10 个上场英雄不重复
- 可勾选 `全局 BP`：整局已上场英雄不可再次上场
- 支持一键 `重置整局`

## 本地运行

直接打开 `index.html` 即可，或使用任意静态服务器：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`

## 部署上线（静态托管）

可直接部署到 GitHub Pages / Vercel / Netlify。

### 方式一：GitHub Pages

1. 把当前目录推送到 GitHub 仓库
2. 在仓库 `Settings -> Pages`
3. Source 选择 `Deploy from a branch`，选择 `main` 分支和根目录
4. 保存后等待发布

### 方式二：Vercel / Netlify

1. 导入仓库
2. Framework Preset 选择 `Other`（或静态站点）
3. Build Command 留空
4. Output Directory 留空或填 `.`
5. 点击 Deploy

## 说明

- 英雄池按位置内置，可在 `app.js` 中维护。
- 如果全局 BP 导致某个位置无可用英雄，会提示“可用英雄不足”。
