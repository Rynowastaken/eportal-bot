# NUTC Portal

個人自架的國立臺中科技大學校園 Dashboard。

這個版本採用 **單一 persistent Chromium session**：

- Dashboard 放在 Cloudflare Access 後面
- 不再有第二層 PIN
- 不再有第二份 Playwright `storage_state`
- 不再需要 `npm run login`
- 樹莓派只保存一個 `.eportal-profile/`
- ePortal 登入、五個系統 SSO、未來課表/API 抓取全部共用同一個 Playwright BrowserContext

## 架構

```text
Browser
  ↓
Cloudflare Access
  ↓
NUTC Portal
  ↓
內嵌 noVNC
  ↓
Xvfb 上的 persistent Chromium
  ↓
official ePortal login
  ↓
.eportal-profile/
  ├─ SSO → AIS
  ├─ SSO → WebMail
  ├─ SSO → Activity
  ├─ SSO → EP
  ├─ SSO → TronClass
  └─ context.request → timetable/API scraping
```

登入時看到的仍然是官方 ePortal 頁面，只是 Chromium 跑在樹莓派上，再透過 noVNC 顯示在 Dashboard 裡。

## 為什麼使用 persistent Chromium

一般瀏覽器的 ePortal cookie 受 same-origin / HttpOnly 等瀏覽器安全規則保護，無法同時直接變成樹莓派背景爬蟲的 session。

因此若要真正「只登入一次、Dashboard 與爬蟲完全共用」，最乾淨的方式就是讓樹莓派上的 persistent Chromium 成為唯一 session owner。

## UI

介面延續同帳號的 [Rynowastaken/budget](https://github.com/Rynowastaken/budget)：

- plain Node.js
- no frontend build step
- dark glass / blur UI
- pink / gold accent
- responsive layout
- 原生 HTML / CSS / JS

## ePortal 模組

| 模組 | ePortal path |
| --- | --- |
| 學生管理系統 | `/?app_id=NUTC_6401` |
| WebMail 郵件系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_lPGpV8f9YqQ8qgA9cyn8QA` |
| 活動報名暨投票系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_PI9bsUzimpCHrDSTPoMVcQ` |
| 學生學習歷程（EP） | `/ext_module/ext_set_param.php?mod_id=_OSL256_pmabVqSXTYna294Vl9JLJg` |
| TronClass | `/ext_module/ext_set_param.php?mod_id=_OSL256_OBbFAusuXIjtGB-G8RS4gQ` |

## Raspberry Pi 安裝

需要 Node.js 18+。

安裝 noVNC / virtual display：

```bash
sudo apt update
sudo apt install -y xvfb x11vnc novnc websockify
```

安裝 Node dependencies：

```bash
npm install
npm run install-browser
```

啟動：

```bash
npm start
```

`npm start` 會一起啟動：

```text
Xvfb :99
x11vnc 127.0.0.1:5900
websockify/noVNC 127.0.0.1:6080
Playwright Chromium
NUTC Portal 127.0.0.1:4173
```

## Cloudflare Access

建議 Cloudflare Tunnel 直接指向：

```text
http://127.0.0.1:4173
```

只有 4173 需要交給 Tunnel。

5900 / 6080 都綁在 localhost；noVNC 由 Node server 的：

```text
/novnc/
```

反向代理出去，所以仍會經過同一層 Cloudflare Access。

不要直接把 Raspberry Pi 的 4173 / 5900 / 6080 port 暴露到 Internet。

## 登入

打開 NUTC Portal 後按：

```text
ePortal 登入
```

Dashboard 會：

1. 把 persistent Chromium 導到官方 ePortal
2. 在同一頁開啟 noVNC
3. 你直接操作官方 ePortal 完成登入
4. 登入 cookie / local storage 保存在 `.eportal-profile/`
5. 關閉登入視窗即可

重新啟動 server 後 Chromium 仍會讀同一個 profile。

## 開啟校務系統

Dashboard 卡片不直接使用固定 JWT。

流程：

```text
/go/ais
  ↓
persistent Chromium 已登入 ePortal
  ↓
ePortal 即時產生新的短效 SSO
  ↓
server 在 ticket 被 Chromium 消耗前攔截 external navigation
  ↓
302 / auto-submit POST
  ↓
目前瀏覽器進入目標系統
```

短效 JWT / SSO ticket 不寫入 Git、不寫入檔案，也不刻意輸出到 console。

## 背景課表抓取

`src/browser-session.js` 已提供：

```js
browserSession.fetchAis(url, options)
```

它會：

1. 使用同一個 persistent ePortal profile
2. 重新走 AIS SSO
3. 使用同一 BrowserContext 的 `context.request`
4. 發 authenticated request

等課表 Network endpoint 確認後，就能直接把這個結果接到 Dashboard API / JSON / CSV，不需要再登入一次。

## Security

唯一需要保護的 ePortal session 資料是：

```text
.eportal-profile/
```

已加入 `.gitignore`。

不要 commit：

- browser profile
- cookies
- JWT
- ASP.NET session
- `PUBLIC_APP_USER_SSO_TOKEN`

noVNC 的 VNC backend 沒有額外 VNC password，因為它只綁 localhost，並由 Cloudflare Access 保護的 Node origin 代理出去。因此 **不要繞過 Cloudflare 直接公開 origin**。

## 專案結構

```text
server.js
src/
  eportal.js
  browser-session.js
public/
  index.html
  app.css
  app.js
scripts/
  start.sh
package.json
```

## Syntax check

```bash
npm run check
```

下一步：找出 AIS 課表 Network endpoint，再把「今日課表 / 本週課表」直接顯示在 Dashboard。
