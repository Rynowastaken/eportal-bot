# NUTC Portal

自架的國立臺中科技大學個人 Dashboard。

目前有兩條彼此獨立的 ePortal session：

- **Server session**：Playwright persistent profile，供背景工作、排程，以及產生各模組的短效 SSO handoff 使用。
- **Client session**：目前瀏覽器自己的 ePortal session；Userscript 只做便利的登入狀態通知與 Dashboard bridge，不會把 cookie 傳給 server。

## Install

```bash
npm install
npm run install-browser
npm run doctor
```

On Linux, `npm run install-browser` installs Chromium plus the system libraries
needed by the headless browser. Debian/Ubuntu systems use Playwright's normal
`--with-deps` installer. Arch/pacman-based systems use the equivalent pacman runtime
packages first, then install Playwright Chromium. This avoids Playwright's unsupported-OS
fallback trying to call `apt-get` on Arch.

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

No graphical desktop is required on the server.

Start the Dashboard first:

```bash
npm start
```

Open the Cloudflare-Access-protected Dashboard from your phone or desktop and press
**登入 Server ePortal**. The native Login Bridge starts a headless Playwright Chromium
against:

```text
.eportal-profile/
```

Complete the ePortal form in the responsive bridge page. After the real server-side
browser reaches the ePortal dashboard, the Chromium context closes and its authenticated
persistent profile remains on disk.

`.eportal-profile/` is credential-equivalent material. It is excluded by
`.gitignore`; do not commit it or copy it to untrusted systems.

For machines that actually have a local graphical desktop, `npm run login` remains
available as a headed Playwright fallback, but it is not required for an SSH-only server.

## Cloudflare Access deployment

The deployed Portal can show its own branded pre-auth screen at `/login`, then hand
authentication to Cloudflare Access. The protected `/auth/start` route triggers the
Access challenge; after the Access policy passes, the origin validates the
`Cf-Access-Jwt-Assertion` signature, issuer, and application AUD before serving the
Dashboard or any API.

Production configuration:

```bash
CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
```

Only `/login*` should be configured as a public/Bypass path in Cloudflare Access.
Everything else stays behind the normal Allow policy.

A Cloudflare Tunnel is **not required**. The bundled no-tunnel deployment keeps Node on
`127.0.0.1:4174`, puts Caddy on public HTTPS/443, and uses a proxied Cloudflare DNS
record. Run `npm run deploy:configure` for an interactive wizard that generates the
environment, Caddy, and systemd files under `.deploy/`. Ready-to-edit templates remain
in `deploy/no-tunnel/`. See
[docs/cloudflare-access.md](docs/cloudflare-access.md) for the complete setup.

## Start Dashboard

```bash
npm start
```

Dashboard 預期放在 Cloudflare Access 後方。Production deployments should enable origin JWT validation as described above.

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

## UI / theming

The Dashboard and Login Bridge use the same self-hosted Tailwind CSS runtime and
Lucide icon set as `Rynowastaken/budget`.

The visual language follows the Budget app's dark glass system:

- translucent cards with a subtle white border and 18px blur,
- rounded 14-20px controls and panels,
- a filled primary control color with an accent hover color,
- compact menu tiles with Lucide icons,
- restrained shadows and short lift-on-hover transitions.

The Dashboard menu also includes **背景圖片**. The selected image is compressed in the
browser and then stored on the Portal server under `data/`. A five-color palette is
sampled from the image using the same OKLab/OKLCH-style extraction approach as the
Budget app, then converted into a Tonal Spot palette for buttons, focus rings, icons,
and card accents. Because the image is server-backed, the same background is available
to the Dashboard, launch screen, and `/server-login/` across devices.

Removing the background restores the default rose/gold palette.

## Dashboard profile storage

The custom Dashboard username, account picture, and background are server-backed.
Metadata is stored in `data/dashboard-preferences.json`; the processed account picture
and background are stored as private files in `data/`. Where supported, these files
use owner-only permissions.

Existing browser-local username, account picture, and background values from older
versions are migrated automatically when that browser first loads the upgraded
Dashboard. The old local username/avatar/background values are removed after a
successful server migration. Color scheme, Colorfulness, and Brightness remain
browser-local preferences.

## Debug restart

The appearance settings include a Debug section with a **Restart** action. By default,
the server performs a self-restart, which is convenient when running it directly with
`npm start`.

If the process is managed by systemd, Docker, PM2, or another supervisor, set:

```bash
EPORTAL_RESTART_MODE=exit
```

In that mode the Debug action exits cleanly and lets the supervisor start the process
again. The restart endpoint closes an active login bridge and clears Activity relay
sessions before restarting.

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
    ├─ headless keepalive / background work
    ├─ SSO handoff generation
    └─ native Login Bridge when reauthentication is required
          ↓
        ePortal

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
- Login Bridge token

檢查程式碼語法與必要檔案：

```bash
npm run check
```
