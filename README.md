# NUTC Portal

個人自架的國立臺中科技大學校園 Dashboard。

這個專案不做假的學校帳密登入頁；官方 ePortal 仍負責真正的身分驗證。第一次人工登入後，樹莓派保存 Playwright `storage_state`，之後由自架 Dashboard 為每個模組即時取得新的短效 SSO ticket。

## UI / architecture

Web UI 直接參考同帳號的 [Rynowastaken/budget](https://github.com/Rynowastaken/budget)：

- plain Node.js server
- 不需要 frontend build step
- dark glass / blur interface
- pink / gold accent
- mobile-first responsive layout
- local access-code login
- 原生 HTML / CSS / JS

## 從 ePortal 附件解析出的入口

| 模組 | ePortal path |
| --- | --- |
| 學生管理系統 | `/?app_id=NUTC_6401` |
| WebMail 郵件系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_lPGpV8f9YqQ8qgA9cyn8QA` |
| 活動報名暨投票系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_PI9bsUzimpCHrDSTPoMVcQ` |
| 學生學習歷程（EP） | `/ext_module/ext_set_param.php?mod_id=_OSL256_pmabVqSXTYna294Vl9JLJg` |
| TronClass | `/ext_module/ext_set_param.php?mod_id=_OSL256_OBbFAusuXIjtGB-G8RS4gQ` |

這些只是 ePortal 的入口，不是要長期保存的登入 token。

## 安裝

需要 Node.js 18+：

```bash
npm install
npx playwright install chromium
```

## 第一次登入官方 ePortal

```bash
npm run login
```

Chromium 會打開官方 ePortal。你正常登入後，程式偵測到「學生管理系統」按鈕就會保存：

```text
eportal-auth-state.json
```

這個檔案視同 session credential，已被 `.gitignore` 排除。

## 啟動自架 Dashboard

```bash
npm start
```

預設：

```text
http://localhost:4173
```

如果沒有設定 `DASHBOARD_PIN`，server 啟動時會印出新的 6 位數本機存取碼。若要固定：

```bash
DASHBOARD_PIN='你的本機存取碼' npm start
```

## SSO launcher

點擊 Dashboard 中的模組時：

1. server 載入 Playwright storage state。
2. 確認 ePortal login 還有效。
3. 進入該模組的官方 ePortal path。
4. 攔截即將離開 `eportal.nutc.edu.tw` 的 top-level navigation。
5. 在 Playwright 真正消耗 ticket 前先中止 external navigation。
6. 將一次性 HTTPS SSO navigation 只回給當下瀏覽器。
7. 由你的瀏覽器真正進入 AIS / WebMail / 活動 / EP / TronClass。

目前 launcher 支援 GET navigation，以及 `application/x-www-form-urlencoded` POST navigation。

短效 JWT / SSO ticket 不寫檔、不 commit，也不刻意輸出到 server console。

> 五個目標系統仍需在你的實際帳號環境逐一驗證，因為各系統可能有不同的 SSO 行為。

## AIS endpoint 抓取

原本的 authenticated request 功能保留：

```bash
node eportal_bot.js run \
  --fetch-url 'https://ais.nutc.edu.tw/student/REPLACE_WITH_TIMETABLE_ENDPOINT'
```

response body 會存到 `output/authenticated_response.bin`，metadata 存到 `output/authenticated_response.json`。敏感 response headers 與疑似 token query value 不會寫入 metadata。

## Security

不要直接把這個服務裸露在公網。建議使用 Raspberry Pi + Tailscale / WireGuard，或 HTTPS reverse proxy 加額外 access control。

永遠不要 commit：

- `eportal-auth-state.json`
- cookies
- JWT / SSO ticket
- ASP.NET session
- `PUBLIC_APP_USER_SSO_TOKEN`
- browser profile

## 主要檔案

```text
server.js            Web server / Dashboard authentication
src/eportal.js       ePortal state + multi-module SSO launcher
public/index.html    Dashboard structure
public/app.css       Budget-inspired glass UI
public/app.js        Frontend behavior
eportal_bot.js       CLI login / AIS fetch helper
```

syntax check：

```bash
npm run check
```

下一步是分析 AIS 課表 Network endpoint，然後把 Dashboard 從 SSO launcher 擴充成真正的資料首頁：今日課表、TronClass 作業、校務信、活動與 EP 摘要。
