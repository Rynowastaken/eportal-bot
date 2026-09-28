# NUTC Portal

自架的國立臺中科技大學個人 Dashboard，使用 **單一 persistent Playwright Chromium profile** 共用 ePortal 登入、各系統 SSO 與後續課表/API 抓取。

介面風格延續 [Rynowastaken/budget](https://github.com/Rynowastaken/budget)，Dashboard 預期放在 Cloudflare Access 後方。

## Quick start

需要 Node.js 18+。

```bash
npm install
npm run install-browser
npm run doctor
npm start
```

`npm run doctor` 會先檢查目前 OS、CPU 架構、圖形環境、Chromium 與 noVNC/VNC 能力，再選擇可用的登入模式。

跨平台與 runtime 設定請看 [docs/platforms.md](docs/platforms.md)。

## How it works

```text
Cloudflare Access
      ↓
NUTC Portal
      ↓
persistent Chromium (.eportal-profile/)
      ├─ official ePortal login
      ├─ AIS / WebMail / 活動 / EP / TronClass SSO
      └─ context.request → timetable/API
```

只有 `.eportal-profile/` 保存 ePortal session；沒有第二份 `storage_state`，也沒有額外的 Dashboard PIN。

## Security

不要 commit：

- `.eportal-profile/`
- cookies / JWT / SSO token
- ASP.NET session
- `PUBLIC_APP_USER_SSO_TOKEN`

Cloudflare Tunnel 建議只連 NUTC Portal 的 HTTP origin，不要直接公開 VNC/noVNC backend。

## Development

```bash
npm run check
```

下一步是接上 AIS 課表 Network endpoint，將課表直接顯示在 Dashboard。
