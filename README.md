# NUTC Portal

自架的國立臺中科技大學個人 Dashboard。ePortal 登入與 SSO 都使用**使用者目前的瀏覽器 session**；Server 不啟動瀏覽器，也不保存學校登入 cookie。

## Quick start

```bash
npm install
npm run doctor
npm start
```

Dashboard 預期放在 Cloudflare Access 後方。

登入狀態橋接使用 repo 內的 userscript：

```text
/userscript/nutc-portal.user.js
```

安裝與手機流程見 [docs/userscript.md](docs/userscript.md)。

## Flow

```text
Client browser
  → official ePortal login
  → Userscript confirms login
  → Dashboard continues /go/:module
  → official ePortal SSO
```

## Security

不要 commit cookies、JWT、SSO token、ASP.NET session 或任何手動匯出的瀏覽器資料。

```bash
npm run check
```
