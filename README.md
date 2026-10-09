<!-- **FOR AGENTS**: **DO NOT** modify the warning text. keep it **AS IS**. -->

> [!WARNING]
> **VIBE CODE REPO AHEAD!**
> 
> This project is entirely vibe coded with GPT-5.6 Sol, thus support and bug fixes are not guaranteed. Use at your own risk.


# NUTC Portal

給國立臺中科技大學學生用的自架 Dashboard。把課表、缺曠紀錄、ePortal 常用系統全部放在同一頁，不用每次重登。

跟其他類似工具最大的差別是：它在 server 上跑一個 headless Chromium 幫你維持 ePortal 登入狀態，但真正存取各子系統的是**你自己的瀏覽器**。server 只負責過橋——從 ePortal 拿到 SSO token 後轉交給你，你的瀏覽器再去目標系統完成登入。這樣 server 不會碰到你的 session 內容，也沒有中間人問題。

> [!NOTE]
> 本專案為非官方個人專案，與國立臺中科技大學官方無關。

## 功能

- 顯示 AIS 每週課表（server 定時爬取，快取 5 分鐘）
- 顯示 AIS 缺曠紀錄（含各類別統計）
- 一鍵開啟五大 ePortal 子系統：學生管理、WebMail、活動報名、EP 學習歷程、TronClass
- Server 端持久保存 ePortal 登入狀態，重開機不用重登
- 登入流程透過網頁表單完成，密碼不落盤
- 自動 keepalive，定時檢查並延續 ePortal session
- 自訂頭像、顯示名稱、背景圖片
- 自訂主題配色（深淺色、色彩飽和度、亮度）
- 桌面與手機 RWD
- 可選擇用 Cloudflare Access 保護公開部署

## 快速開始

### 你需要

- Node.js 18 以上
- npm
- NUTC ePortal 帳號
- 一台能上網的電腦（本機或 server 都行）

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot

npm install
npm run install-browser
npm run doctor
```

啟動：

```bash
npm start
```

瀏覽器開 `http://localhost:4174`。

本機使用到這邊就完成了，不用管 Cloudflare Access。

> `npm run install-browser` 會裝 Playwright Chromium，在大多數 Linux 發行版上也會順便裝需要的系統套件。

## 第一次登入

打開 Dashboard，點 **登入 Server ePortal**。

這時 server 會在背景開一個 Chromium 瀏覽器，並把 ePortal 登入頁面透過「Login Bridge」顯示給你看。你在網頁上輸入帳密，server 幫你打到真實的瀏覽器裡。登入完成後，整個瀏覽器狀態會存在：

```text
.eportal-profile/
```

server 不需要圖形桌面環境，你可以用手機或另一台電腦完成登入。

> [!IMPORTANT]
> `.eportal-profile/` 就是你已登入的瀏覽器狀態，等同帳號憑證。不要 commit、不要公開上傳、不要複製到不信任的電腦。

## 它是怎麼運作的

1. **課表與缺曠** — server 用已登入的 Chromium 直接去 AIS 撈資料，快取 5 分鐘回傳 JSON 給前端渲染
2. **子系統 SSO** — 點擊某個模組時，server 去 ePortal dashboard 點對應按鈕，攔截 SSO 轉導流程，抓出目標系統的 login URL（或 POST form），回傳給你自己的瀏覽器去執行。你的瀏覽器直接跟目標系統建立 session，server 不經手內容
3. **活動報名系統** — 因為目標是舊架構 HTTP 系統，沒辦法乾淨轉交 SSO URL，所以 server 會跑一個暫存 30 分鐘的 reverse proxy，把頁面內容即時轉譯給你
4. **Login Bridge** — 登入時的表單是即時從 ePortal 頁面擷取的（含驗證碼圖片），你在網頁上填什麼 server 就打什麼進 Chromium，密碼跟 MFA 只存在記憶體，不會寫入任何檔案或 log
5. **Keepalive** — 預設每 10 分鐘檢查一次 ePortal session 是否還有效

## 部署到其他電腦

放到家用 server、樹莓派、VPS 等長時間運作的機器上，步驟一樣：

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot

npm install
npm run install-browser
npm run doctor
npm start
```

預設 port `4174`。要讓區網內其他裝置連線：

```bash
HOST=0.0.0.0 PORT=4174 npm start
```

假設 server IP 是 `192.168.1.20`，其他裝置開 `http://192.168.1.20:4174` 即可。

> 只在區網使用的話確保網路環境可信任，不要直接把 port 暴露到公網。

## 部署到公網

架構：

```text
Internet
  ↓
Cloudflare Access（驗證使用者身份）
  ↓
Caddy HTTPS Reverse Proxy
  ↓
NUTC Portal（127.0.0.1:4174）
```

基本安裝完成後，在 Linux server 上跑：

```bash
npm run deploy:configure
```

設定精靈會依序詢問 domain、Cloudflare Access 參數、service 使用者、TLS 憑證路徑等。完成後 `.deploy/` 會有部署設定檔。

確認無誤：

```bash
sudo npm run deploy:configure -- --install
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now eportal-bot
sudo systemctl reload caddy
```

Cloudflare 那邊的 DNS、Access Application、Origin CA 憑證還是要自己去 Cloudflare 後台設定。詳細步驟見 [Cloudflare Access 部署文件](docs/cloudflare-access.md)。

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm start` | 啟動 Dashboard |
| `npm run doctor` | 檢查執行環境是否就緒 |
| `npm run check` | 檢查所有 JS 語法 |
| `npm test` | 檢查假日與校曆邏輯 |
| `npm run install-browser` | 安裝 Playwright Chromium 及系統套件 |
| `npm run portal:status` | 查看 ePortal 登入狀態 |
| `npm run login` | 用有 GUI 的 Playwright 手動登入（備用方案） |
| `npm run deploy:configure` | 產生部署設定 |
| `npm run deploy:check` | 檢查部署設定是否完整 |

## 環境變數

本機使用通常不用改。

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `4174` | HTTP port |
| `HOST` | `0.0.0.0` | 繫結 IP |
| `EPORTAL_KEEPALIVE_MINUTES` | `10` | 自動檢查 session 的間隔（分鐘），設 0 關閉 |
| `EPORTAL_LOGIN_BRIDGE_TTL_MINUTES` | `15` | Login Bridge 的有效時間 |
| `EPORTAL_RESTART_MODE` | `self` | 用 systemd 管理時設 `exit`；重新啟動請求會以非零狀態退出，讓 `Restart=on-failure` 接手啟動新程序 |
| `EPORTAL_ACADEMIC_PROGRAM` | `day` | 假日／校曆適用學制：`day`、`evening`、`weekend` |
| `CLOUDFLARE_ACCESS_ENFORCE` | — | 設 `1` 啟用 origin JWT 驗證 |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | — | Cloudflare Access team domain |
| `CLOUDFLARE_ACCESS_AUD` | — | Cloudflare Access Application AUD |

## 課表假日與補課

課表維持原本的每週時間格視圖，並標示本週假日／停課日。一般課程資料仍來自 NUTC AIS。已確認停課日的課程會變淡，但保留原課表供參考；**不會自動新增調課後的課程**。

- 國定假日：伺服器按年份讀取 [中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718) 的 [TaiwanCalendar JSON](https://github.com/ruyut/TaiwanCalendar)，快取 24 小時；CDN 無法連線時改用舊快取，沒有快取則只套用校曆例外並顯示提示。
- 校曆例外：`src/nutc-calendar-overrides.json` 依 [中科大 115 學年度行事曆](https://aca.nutc.edu.tw/p/412-1015-4596.php) 手動整理；請在學校公布新版行事曆或調課公告後更新此檔案。明確的單日例外優先於國定假日；一般週六日不會自動被視為停課日。
- 學制：設定 `EPORTAL_ACADEMIC_PROGRAM=day`（預設／日間部）、`evening`（進修部夜間班）或 `weekend`（進修部假日班）。校曆各學制的上課日／停課日不同，請依自己的學制設定；修改環境變數後須重啟服務。
- 校曆資料結構：`days` 可填 `{ "date": "2027-04-02", "label": "校慶補假", "noClass": true, "programs": ["day", "evening", "weekend"] }`，`ranges` 可填 `{ "start": "2027-01-11", "end": "2027-02-21", "label": "寒假", "noClass": true, "programs": ["day"] }`。需要覆寫國定假日的照常上課日，將 `noClass` 設為 `false` 即可。

可執行 `npm test` 檢查假日來源優先序、時區與校曆例外。

## 資料與隱私

所有資料都在你機器的這兩個目錄：

- `.eportal-profile/` — 已登入的 Chromium 瀏覽器狀態（cookies、localStorage 等）
- `data/` — 自訂的頭像、背景圖、顯示名稱等偏好設定

Login Bridge 處理的帳號密碼與 MFA 驗證碼只存在記憶體中，不會寫入任何檔案或 log。

**不要 commit 或分享：**

- `.eportal-profile/`
- `data/` 中的私人檔案
- cookies 或匯出的瀏覽器 session
- JWT / SSO Token
- Login Bridge Token
- 部署設定檔中的私密資訊

## 進階文件

- [Cloudflare Access 部署](docs/cloudflare-access.md)
- [Userscript / Client Browser 整合](docs/userscript.md)

大多數使用者只要完成**快速開始**跟**第一次登入**就能正常使用了。
