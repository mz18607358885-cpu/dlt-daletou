# v29 线上站点(Cloudflare Pages 实际部署产物)

本目录是 `https://dlt-pro.pages.dev` 线上站点的**完整源码**。

## 为什么单独存一份

2026-10-24 那次部署把 `app.js` 和 `formulas.js` **写成了截断文件**:
- `app.js` 73047 / 151037 字节,断在第 1776 行 `⚖ ` 处 → 浏览器 `SyntaxError` → 整个 APP 对象不执行 → 登录按钮无事件 → 站点"登不进去"
- `formulas.js` 5467 / 13245 字节,断在第 146 行 `const s` 处 → 杀号公式库整体失效

而这套源码**从未进入 GitHub**,只存在于 Cloudflare Pages 的部署产物里,导致问题排查极其困难。
本目录把线上产物固化为版本控制基线,避免再次无源码可依。

## 文件说明

| 文件 | 说明 |
|---|---|
| `app.js` | 主程序,`const APP = {...}`。含登录、杀号、智能选号、收藏、统计面板 |
| `formulas.js` | 杀号公式库,`window.DLT_FORMULAS`,前区 10 个 + 后区 5 个 |
| `data.js` | 历史开奖数据,`window.DLT_DATA` + `window.DLT_HELPERS` |
| `devices.js` | 设备指纹与副链接设备数校验 |
| `index.html` | 单页外壳,含登录界面 |
| `styles.css` / `manifest.json` / `icon.*` | 静态资源 |

## 密码

- 主链接:**918918**
- 副链接:**112233**

`app.js:138` 与 `app.js:215` 为明文比对。

## 数据格式

`window.DLT_DATA` 为**旧到新**排序,期号格式 `2026124`(7 位,年份+序号):

```js
{period:"2026124", date:"2026-10-31", front:[12,14,18,22,27], back:[1,9]}
```

下一期由 `window.DLT_HELPERS.nextPeriod()` 自动推算,插入新期无需手动改。

## 部署

```bash
cd v29-site
npx wrangler pages deploy . --project-name=dlt-pro --commit-dirty=true --branch=main
```

## 已知问题

1. `app.js` 的 `fetchFromCloud()` 请求 `/.netlify/functions/fetch-latest` 与 `/api/fetch-latest`,
   这两个是 **Netlify Functions** 端点,在 Cloudflare Pages 上不存在 → 状态栏会一直显示"🌐 拉取中..."。
   数据更新目前依赖本地 `data.js`,不受影响。
2. `devices.js` 同样依赖 `/.netlify/functions/devices`,副链接设备数校验在 CF Pages 上不生效。
3. 部署后请校验 `app.js` 字节数应为 **151037**、`formulas.js` 为 **13245**。
   若偏小则文件又被截断,需立即重新部署。
