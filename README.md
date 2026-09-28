# NUTC Portal

自架的國立臺中科技大學個人 Dashboard。

目前有兩條彼此獨立的 ePortal session：

- **Server session**：Playwright persistent profile，供背景工作、排程與未來課表抓取使用。
- **Client session**：目前瀏覽器自己的 ePortal session；Userscript 只做便利的登入狀態通知與 Dashboard bridge，不會把 cookie 傳給 server。

## Install

```bash
npm install
npx playwright install chromium
npm run doctor
```

## First server login

第一次在 server 主機執行：

```bash
npm run login
```

這會開啟 headful Chromium。手動登入官方 ePortal 一次；登入成功後 Playwright 會自動保留完整 persistent browser profile：

```text
.eportal-profile/
```

這個目錄等同登入憑證，已由 `.gitignore` 排除，絕對不要 commit、備份到公開位置或傳給其他裝置。

## Start Dashboard

```bash
npm start
```

Dashboard 預期放在 Cloudflare Access 後方。

Server-side ePortal 狀態可由：

```text
GET /api/portal-status
```

查詢。回傳狀態包含：

```text
valid
needs-login
not-configured
error
```

Dashboard 也會顯示 server session 是否需要重新登入。

## Headless/background use

確認保存的 server session：

```bash
npm run portal:status
```

使用保存的 profile 以 headless Chromium 進入 ePortal 並完成 AIS SSO：

```bash
npm run run
```

這條路徑不依賴 client browser 或 Userscript，適合 cron / scheduler。未來的 timetable fetcher 可以直接使用 `src/portal-session.js` 的 `openAisWithServerSession()`，在同一個 authenticated Playwright context 裡抓 AIS endpoint。

若 ePortal session 過期，headless 檢查會判定為 `needs-login`，重新執行：

```bash
npm run login
```

即可刷新 server profile。

Cron 範例：

```cron
15 6 * * * cd /home/pi/eportal-bot && /usr/bin/npm run run >> /home/pi/eportal-bot/eportal.log 2>&1
```

避免同時啟動兩個使用同一個 `.eportal-profile/` 的 Chromium process；Chromium persistent profile 不適合並行開啟。

## Client browser / Userscript

Userscript 位於：

```text
/userscript/nutc-portal.user.js
```

它只執行在使用者目前的瀏覽器，負責 client-side ePortal 登入偵測與 Dashboard bridge。它不讀取 HttpOnly cookie，也不會把 ePortal cookie 傳回 server。

安裝與手機流程見 [docs/userscript.md](docs/userscript.md)。

## Architecture

```text
Server
  .eportal-profile/
    ↓
  Playwright persistent Chromium
    ↓ headless
  ePortal
    ↓ official SSO
  AIS
    ↓
  scheduled/background data fetch

Client browser
    ↓
  official ePortal
    ↓
  optional Userscript bridge
    ↓
  Dashboard /go/:module
```

Server 與 client session 完全分離。

## Security

不要 commit：

- `.eportal-profile/`
- cookies
- JWT / SSO tokens
- `ASP.NET_SessionId`
- `PUBLIC_APP_USER_SSO_TOKEN`
- 手動匯出的 browser state

檢查程式碼語法與必要檔案：

```bash
npm run check
```
