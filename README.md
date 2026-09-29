# NUTC Portal

自架的國立臺中科技大學個人 Dashboard。

目前有兩條彼此獨立的 ePortal session：

- **Server session**：Playwright persistent profile，供背景工作、排程，以及產生各模組的短效 SSO handoff 使用。
- **Client session**：目前瀏覽器自己的 ePortal session；Userscript 只做便利的登入狀態通知與 Dashboard bridge，不會把 cookie 傳給 server。

## Install

```bash
npm install
npx playwright install chromium
npm run doctor
```

## Native server re-login from mobile or desktop

Normal Dashboard operation stays fully headless. When the saved server ePortal session
expires, open the Dashboard and press **登入 Server ePortal**.

The Dashboard starts a short-lived headless Playwright login session using the same
`.eportal-profile/`, then opens `/server-login/`. The browser page is a normal
responsive HTML form: inputs, selects, checkboxes, buttons, messages, and small
verification images are mirrored from the real ePortal login page.

There is **no remote desktop or pixel stream**. Your phone or desktop renders native
HTML controls, so mobile keyboards, password managers, accessibility, scrolling, and
desktop layouts behave normally. Network traffic is limited to small JSON form-state
updates plus any individual verification images that are actually needed.

Form values are sent over the protected Dashboard connection only when you submit an
action, filled into the real server-side Playwright page, and kept in memory only. The
application does not intentionally log or persist passwords or MFA codes. The ePortal
cookies remain exclusively inside `.eportal-profile/`.

The bridge holds the persistent-profile lock for its lifetime, so keepalive jobs and SSO
handoff generation cannot open a second Chromium against the same profile. The default
bridge lifetime is 15 minutes and can be changed with:

```bash
EPORTAL_LOGIN_BRIDGE_TTL_MINUTES=10 npm start
```

If the login flow leaves NUTC HTTPS origins or uses a browser feature the bridge cannot
represent, the bridge stops rather than proxying arbitrary external authenticated pages.

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
busy
needs-login
not-configured
error
```

Dashboard 也會顯示 server session 是否需要重新登入。

## Session keepalive

While the Dashboard server is running, it periodically opens the authenticated ePortal
dashboard with the same persistent `.eportal-profile/`. This gives ePortal a normal
authenticated page load and allows any sliding/idle session timeout or refreshed cookies
to be renewed and persisted back into the profile.

Default cadence:

```text
10 minutes
```

Configure it with:

```bash
EPORTAL_KEEPALIVE_MINUTES=5 npm start
```

Disable it with:

```bash
EPORTAL_KEEPALIVE_MINUTES=0 npm start
```

`GET /api/portal-status` also returns a `keepalive` object containing whether it is
enabled, the interval, the last attempt, the last successful refresh, and the last
observed status.

Keepalive can reduce **idle-session expiration**, but it cannot override an absolute
session lifetime, forced logout, password/MFA change, or server-side revocation imposed
by ePortal. In those cases run `npm run login` again.

All uses of the persistent profile inside the Dashboard server are serialized so a
keepalive refresh does not launch Chromium against the profile at the same time as an
SSO handoff.

## Short-lived SSO handoff launches

Every Dashboard card points to:

```text
/go/:module
```

The browser does not go to ePortal first. Instead the server:

1. opens the saved `.eportal-profile/` headlessly,
2. verifies that the server-side ePortal session is still valid,
3. requests the selected ePortal module with automatic redirects disabled,
4. follows only redirects that stay inside `https://eportal.nutc.edu.tw`,
5. stops at the first external HTTPS redirect,
6. immediately returns a `302` to the client for that external SSO handoff.

Because the server stops before following the external redirect, it does not consume the
short-lived target-system handoff itself. The incognito/guest browser receives that
handoff and the target system can establish its own browser session.

The handoff URL is never persisted or logged by this application. Redirect responses
use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

If a module does not expose its SSO transition as an HTTP redirect, `/go/:module`
returns a handoff-unavailable error instead of attempting to copy server cookies into
the browser.

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

若 ePortal session 過期，headless 檢查會判定為 `needs-login`。一般情況直接在 Dashboard 點 **登入 Server ePortal**，透過 native HTML Login Bridge 刷新 server profile。`npm run login` 仍保留給有圖形桌面的本機維護情境。

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
  Dashboard /go/:module
    ↓
  server generates fresh SSO handoff
    ↓
  target system establishes client session

Server re-login
    ↓
  Dashboard /server-login/
    ↓
  native HTML controls / small JSON actions
    ↓
  headless Playwright real ePortal login page
    ↓
  refreshed .eportal-profile/
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
