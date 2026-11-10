# 工序五金｜店內找貨

五金行商品搜尋與貨架位置查詢。

## 檔案說明

| 檔案 | 用途 |
|---|---|
| `Index.html` | 顧客前台（GAS 與靜態網站共用） |
| `Admin.html` | 後台管理（目前僅在 Google Apps Script 部署中可用） |
| `Code.js`, `appsscript.json` | Google Apps Script 後端 |
| `products.csv` | 商品範例資料 |

## 本機預覽

```
npm run dev
```

## 部署

靜態網站從 `public/` 部署（由 `npm run build` 產生）：

- **GitHub Pages**：推送到 `main` 後自動部署（`.github/workflows/pages.yml`）
- **Netlify**：`netlify deploy --prod`（設定在 `netlify.toml`）
- **Vercel**：`vercel --prod`（設定在 `vercel.json`）
- **Cloudflare Workers**：`wrangler deploy`（設定在 `wrangler.toml`）

靜態版前台目前顯示示範資料；連接 Google 試算表資料需要將 GAS 改為 JSON API。
