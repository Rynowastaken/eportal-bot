# NUTC Portal

自架的國立臺中科技大學個人 Dashboard。ePortal 登入與 SSO 全部使用**使用者目前的瀏覽器 session**；Server 不啟動瀏覽器，也不保存學校登入 cookie。

## Quick start

需要 Node.js 18+。

```bash
npm install
npm run doctor
npm start
```

Dashboard 預期放在 Cloudflare Access 後方。

若要讓 Dashboard 在官方 ePortal 登入成功後自動更新狀態並接續開啟模組，載入 repo 內的 `extension/` WebExtension。詳細方式見 [docs/client-login.md](docs/client-login.md)。

## Flow

```text
Client browser
  → official ePortal login
  → ePortal cookie stays in that browser
  → NUTC Portal /go/:module
  → official ePortal SSO
  → AIS / WebMail / 活動 / EP / TronClass
```

## Security

不要 commit cookies、JWT、SSO token、ASP.NET session 或任何手動匯出的瀏覽器資料。

```bash
npm run check
```
