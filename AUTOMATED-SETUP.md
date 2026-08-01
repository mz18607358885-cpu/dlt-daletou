# 全自动数据更新 - GitHub Actions 部署指南

## 为什么需要这个

当前 Netlify Drop 部署**无法做到全自动数据更新**——Netlify 的 Scheduled Functions 只支持 Git/CLI 部署,不支持 Drop。

但只要把代码推到 GitHub,用 **GitHub Actions** + **Netlify Git 部署** 就能实现:
- ✅ 每周一/三/六 21:35 自动抓大乐透数据
- ✅ 自动 commit + push 到 GitHub
- ✅ Netlify 监听 GitHub 自动部署
- ✅ 网站数据**永远是最新的**,你完全不用操作

## 步骤(一次性,5 分钟搞定)

### 第 1 步:在 GitHub 创建 repo

1. 注册/登录 https://github.com
2. 点 **+** → **New repository**
3. Repository name: `dlt-lottery`(随便起)
4. 选 **Public**(私有 repo GitHub Actions 每月有 2000 分钟限制,公开免费无限)
5. **不要**勾选 "Add a README"
6. 点 **Create repository**

### 第 2 步:推送代码到 GitHub

在本地(你的电脑)打开终端,把代码 push 上去:

```bash
# 解压我给你的 dlt-v3.zip
# 进入解压后的目录(里面有 dist/、.github/、README.md 等)

cd dist  # 进入 dist 目录

git init
git add .
git commit -m "初始部署"
git branch -M main
git remote add origin https://github.com/你的用户名/dlt-lottery.git
git push -u origin main
```

(把 `你的用户名` 换成你的 GitHub 用户名)

### 第 3 步:在 Netlify 改成 Git 部署

1. 登录 https://app.netlify.com/,打开 `dulcet-torte-c2824d` 站点
2. **Site settings** → **Build & deploy** → **Continuous deployment** → **Link repository**
3. 选 **GitHub**,授权,选你的 `dlt-lottery` repo
4. **Build settings**:
   - Branch to deploy: `main`
   - Build command: 留空
   - Publish directory: `.` (一个点)
5. 点 **Deploy site**
6. 等 1-2 分钟部署完成,URL 还是 `https://dulcet-torte-c2824d.netlify.app/`

### 第 4 步:测试自动更新

1. 打开 https://github.com/你的用户名/dlt-lottery/actions
2. 左侧选 **"定时更新大乐透数据"**
3. 右侧点 **Run workflow** → 绿色按钮
4. 等 1-2 分钟,看是否变绿勾(成功)
5. 回到 Netlify 站点,看 "Deploys" → 应该有新的一次部署
6. 打开网站,看最新开奖结果是不是更新了

### 之后就全自动了

- 每周一/三/六 北京时间 21:35,GitHub Actions 自动跑
- 抓数据 → commit → Netlify 自动部署
- 你**完全不用操作**

## 原理

```
[GitHub Actions cron] → 抓体彩 API → 写 data/history.json → commit/push
                                                              ↓
                                       [Netlify 监听 GitHub webhook]
                                                              ↓
                                                  自动部署新版本
                                                              ↓
                                              [你的网站] 显示新数据
```

## 排错

**Actions 跑失败?**
- 看 https://github.com/你的用户名/dlt-lottery/actions 里的错误日志
- 90% 情况是体彩 WAF 拦了,GitHub Action 会自动重试 3 次
- 实在不行 Actions 失败也不影响网站(用上次的数据)

**Netlify 没自动部署?**
- Site settings → Build & deploy → Continuous deployment 检查 webhook 状态
- 手动点 "Trigger deploy" → "Deploy site"

## 不想要全自动了

随时可以:
- 在 repo 的 `.github/workflows/update-lottery.yml` 删掉文件
- 或在 Settings → Actions → 禁用 workflow

## 想要的更多

如果以后想要"每天更新"或"实时推送",可以升级到:
- Cloudflare Pages + Worker(免费,功能更强)
- Vercel + Cron(免费)
- 自建 VPS(完全自由)
