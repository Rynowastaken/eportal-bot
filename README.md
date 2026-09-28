# NUTC ePortal → AIS automation

使用 Node.js + Playwright 自動重用 ePortal 登入狀態，進入「學生管理系統（AIS）」。

這個專案不會硬編碼帳號密碼、不會直接讀 Chrome Cookies SQLite，也不會長期保存 SSO JWT。

## 安裝

需要 Node.js 18 以上。

```bash
npm install
npx playwright install chromium
```

在 Raspberry Pi OS 上，Chromium 支援會依系統版本與架構不同。如果 Playwright 內建 Chromium 無法安裝，可改用 Playwright 支援的 Linux/container 環境。

## 第一次登入

```bash
npm run login
```

會開啟 Chromium。正常登入 ePortal，等程式偵測到「學生管理系統」按鈕後，會保存：

```text
eportal-auth-state.json
```

這個檔案包含登入狀態，應視同憑證保管，而且已被 `.gitignore` 排除。

## 自動執行

```bash
npm run run
```

流程：

1. 載入 `eportal-auth-state.json`
2. 驗證 ePortal 登入狀態
3. 進入 `https://eportal.nutc.edu.tw/?app_id=NUTC_6401`
4. 讓網站正常產生短效 SSO JWT 並完成 redirect
5. 到達 `ais.nutc.edu.tw`
6. 保存 AIS landing HTML 到 `output/ais_landing.html`
7. 保存 SSO 過程中更新過的 Playwright storage state

若想看到瀏覽器：

```bash
npm run run:headed
```

## 使用已驗證的 AIS session 抓 endpoint

找到真正的課表 endpoint 後：

```bash
node eportal_bot.js run \
  --fetch-url 'https://ais.nutc.edu.tw/student/REPLACE_WITH_TIMETABLE_ENDPOINT'
```

request 會使用 `BrowserContext.request`，與 BrowserContext 共用 cookie jar，不需要自行讀取或列印 session cookie。

`--fetch-url` 只允許：

```text
https://ais.nutc.edu.tw/
```

response body 會存到：

```text
output/authenticated_response.bin
```

metadata 會存到：

```text
output/authenticated_response.json
```

其中 `Set-Cookie` 等敏感 response headers 不會被保存；URL 中疑似 token/JWT/session/auth 的 query value 也會遮罩。

## Raspberry Pi cron 範例

假設專案在 `/home/pi/eportal-bot`：

```cron
15 6 * * * cd /home/pi/eportal-bot && /usr/bin/npm run run >> /home/pi/eportal-bot/eportal.log 2>&1
```

若 ePortal 的 server-side login session 過期，重新執行：

```bash
npm run login
```

即可刷新登入狀態。

## 下一步：課表 endpoint

目前 bot 已完成：

```text
storage state
→ ePortal
→ NUTC_6401
→ SSO
→ AIS authenticated context
```

下一步是從 DevTools Network 找出課表 request，確認它是：

- JSON / XHR API
- 一般 GET / POST
- 或 ASP.NET WebForms postback

如果是 WebForms，會進一步處理：

```text
__VIEWSTATE
__VIEWSTATEGENERATOR
__EVENTVALIDATION
__EVENTTARGET
__EVENTARGUMENT
```
