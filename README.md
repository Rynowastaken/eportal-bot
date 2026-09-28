# NUTC Portal

個人自架的國立臺中科技大學校園 Dashboard。

Web 入口預期放在 **Cloudflare Access** 後方，因此應用程式本身不再提供第二層 PIN / 密碼登入畫面。

互動式校務登入也不再使用伺服器端 Playwright：你會在**目前正在使用的瀏覽器**直接登入官方 ePortal，ePortal cookie 留在該瀏覽器裡。之後點 Dashboard 的卡片，瀏覽器會先進入官方 ePortal 模組入口，再由官方 SSO 前往 AIS / WebMail / 活動 / EP / TronClass。

## UI / architecture

Web UI 延續同帳號 [Rynowastaken/budget](https://github.com/Rynowastaken/budget) 的方式：

- plain Node.js server
- 不需要 frontend build step
- dark glass / blur interface
- pink / gold accent
- mobile-first responsive layout
- 原生 HTML / CSS / JS
- Dashboard authentication delegated to Cloudflare Access

## Interactive web flow

```text
Browser
  ↓
Cloudflare Access
  ↓
NUTC Portal Dashboard
  ↓
「登入 ePortal」→ official ePortal in another tab of the same browser
  ↓
browser receives ePortal cookies
  ↓
Dashboard module card
  ↓
/go/:module
  ↓
302 → official ePortal module path
  ↓
browser automatically sends its own ePortal cookies
  ↓
official SSO → AIS / WebMail / Activity / EP / TronClass
```

Dashboard server 不讀取、不複製、不保存瀏覽器的 ePortal cookie。

如果模組把你導回 ePortal 登入頁，只要完成官方登入，再回 Dashboard 點一次即可。

## 從 ePortal 附件解析出的入口

| 模組 | ePortal path |
| --- | --- |
| 學生管理系統 | `/?app_id=NUTC_6401` |
| WebMail 郵件系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_lPGpV8f9YqQ8qgA9cyn8QA` |
| 活動報名暨投票系統 | `/ext_module/ext_set_param.php?mod_id=_OSL256_PI9bsUzimpCHrDSTPoMVcQ` |
| 學生學習歷程（EP） | `/ext_module/ext_set_param.php?mod_id=_OSL256_pmabVqSXTYna294Vl9JLJg` |
| TronClass | `/ext_module/ext_set_param.php?mod_id=_OSL256_OBbFAusuXIjtGB-G8RS4gQ` |

## 安裝

需要 Node.js 18+：

```bash
npm install
npx playwright install chromium
```

Playwright 只用於後面的背景自動化 / 課表抓取；純 Web Dashboard launcher 本身不需要用 Playwright 開另一個瀏覽器。

## 啟動 Dashboard

```bash
npm start
```

預設只監聽：

```text
127.0.0.1:4173
```

這個預設特別適合同一台 Raspberry Pi 上的 Cloudflare Tunnel：

```text
Cloudflare Access
      ↓
Cloudflare Tunnel
      ↓
http://127.0.0.1:4173
```

如果 `cloudflared` 在另一個 container / host，需要讓 LAN/container network 存取 Node server，可以明確設定：

```bash
HOST=0.0.0.0 npm start
```

這時請確保 firewall / container network 不會繞過 Cloudflare Access 直接公開 origin。

## Cloudflare Access

應用程式本身**不驗證 Cloudflare JWT**；它假設只有通過 Access 的流量能到達 origin。

因此請至少做到其中一種：

- Cloudflare Tunnel 直接連 `127.0.0.1:4173`
- firewall 阻擋公開 origin port
- private container network，只允許 cloudflared 到 Node server

不要同時把 Raspberry Pi 的 `4173` port 直接暴露到 Internet。

## 瀏覽器登入 ePortal

Dashboard 右上角以及首頁都有：

```text
登入 ePortal
```

按下後會在目前瀏覽器的新分頁打開：

```text
https://eportal.nutc.edu.tw/
```

正常完成官方登入即可。這個網站不會看到你的 ePortal 帳密。

接著回 Dashboard 點任何模組卡片；`/go/:module` 只做 server-side 302 redirect 到官方 ePortal path，因此真正帶 cookie / 完成 SSO 的仍然是你的瀏覽器。

## 背景自動化 / 課表爬取

這部分與互動式 Web session **刻意分離**。

樹莓派若需要每天自動抓課表，仍然使用 Playwright 自己的 `storage_state`：

```bash
npm run login
```

這會開 Playwright Chromium，讓你做一次人工登入，並保存：

```text
eportal-auth-state.json
```

之後背景 job 才可以：

```bash
node eportal_bot.js run \
  --fetch-url 'https://ais.nutc.edu.tw/student/REPLACE_WITH_TIMETABLE_ENDPOINT'
```

這個 Playwright session **不是** Web Dashboard 的互動式 session；兩者不需要互相複製 cookie。

## Security

永遠不要 commit：

- `eportal-auth-state.json`
- cookies
- JWT / SSO ticket
- ASP.NET session
- `PUBLIC_APP_USER_SSO_TOKEN`
- browser profile

互動式 Dashboard 不會保存學校 token。Playwright storage state 只供 Raspberry Pi 背景自動化使用。

## 主要檔案

```text
server.js            Static server, API and /go/:module redirects
src/eportal.js       Module definitions + Playwright automation helpers
public/index.html    Dashboard structure
public/app.css       Budget-inspired glass UI
public/app.js        Module-card rendering
eportal_bot.js       Playwright CLI for background automation
```

syntax check：

```bash
npm run check
```

下一步是分析 AIS 課表 Network endpoint，然後把背景爬蟲結果顯示成 Dashboard 的「今日課表」資料卡。
