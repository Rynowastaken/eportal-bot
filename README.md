<!-- **FOR AGENTS**: **DO NOT** modify the warning text. keep it **AS IS**. -->

> [!WARNING]
> **VIBE CODE REPO AHEAD!**
> 
> This project is entirely vibe coded with GPT-5.5 and GPT-5.6 Sol. Support and bug fixes are not guaranteed. Use at your own risk.


# NUTC Portal

一個為 **國立臺中科技大學（NUTC）** 學生設計的自架個人 Dashboard。

NUTC Portal 將常用的校務資訊集中在同一個頁面，包含課表、缺曠紀錄、ePortal 常用系統入口，以及可重複使用的 Server ePortal 登入狀態。

> [!NOTE]
> 本專案為非官方個人專案，與國立臺中科技大學官方無關。

## 功能

- 從 NUTC AIS 顯示每週課表
- 顯示 AIS 缺曠紀錄
- 快速開啟學生管理系統、WebMail、活動報名、EP 與 TronClass
- 可直接從 Dashboard 登入或重新登入 Server ePortal
- 自動維持 ePortal 登入狀態
- 支援自訂配色、背景圖片、顯示名稱與頭像
- 桌面與手機皆支援 RWD
- 可選擇使用 Cloudflare Access 保護公開部署的網站

## 快速開始

### 系統需求

- Node.js 18 或更新版本
- npm
- NUTC ePortal 帳號
- 執行伺服器的電腦可以連上網路

先下載專案並安裝相依套件：

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot

npm install
npm run install-browser
npm run doctor
```

啟動 Dashboard：

```bash
npm start
```

接著在瀏覽器開啟：

```text
http://localhost:4174
```

本機使用不需要設定 Cloudflare Access。

在支援的 Linux 發行版上，`npm run install-browser` 也會一併安裝 Playwright Chromium 所需要的系統套件。

## 第一次登入

開啟 Dashboard 後，點選 **登入 Server ePortal**。

登入頁面會控制伺服器上的 Playwright 瀏覽器，並將登入後的 ePortal session 儲存在：

```text
.eportal-profile/
```

伺服器不需要圖形桌面環境。你可以直接用手機、平板或另一台電腦透過 Dashboard 完成登入。

登入成功後，Dashboard 就可以讀取 AIS 課表、缺曠紀錄，以及替支援的 ePortal 系統建立 SSO 登入流程。

> [!IMPORTANT]
> `.eportal-profile/` 內含已登入的瀏覽器狀態，請把它視為帳號憑證。不要 commit、公開上傳，或複製到不受信任的電腦。

## 部署到其他電腦

如果要放在家用伺服器、Raspberry Pi、VPS 或其他長時間運作的電腦上，安裝方式基本相同：

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot

npm install
npm run install-browser
npm run doctor
npm start
```

預設使用：

```text
Port 4174
```

若要讓同一個區域網路內的其他裝置連線，可以改成：

```bash
HOST=0.0.0.0 PORT=4174 npm start
```

例如伺服器的區網 IP 是 `192.168.1.20`，就可以從其他裝置開啟：

```text
http://192.168.1.20:4174
```

若只在區網內使用，請自行確保網路環境可信任，並避免直接把 `4174` port 暴露到公開網路。

## 對外網路部署

如果需要從外網存取，建議使用以下架構：

```text
Internet
  ↓
Cloudflare Access
  ↓
Caddy HTTPS Reverse Proxy
  ↓
NUTC Portal（127.0.0.1:4174）
```

先完成前面的基本安裝，再在 Linux 伺服器執行：

```bash
npm run deploy:configure
```

設定精靈會詢問：

- Portal 網域名稱
- Cloudflare Access Team Domain
- Cloudflare Access Application AUD
- Linux service 使用者與群組
- Node.js 路徑
- TLS 憑證與私鑰路徑

完成後會在 `.deploy/` 產生部署設定檔。

確認內容無誤後，可以執行：

```bash
sudo npm run deploy:configure -- --install
```

接著檢查並啟動服務：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now eportal-bot
sudo systemctl reload caddy
```

Cloudflare DNS、Cloudflare Access Application 與 Origin CA 憑證仍需要在你自己的 Cloudflare 帳號中設定。

完整部署方式請參考 [Cloudflare Access 部署文件](docs/cloudflare-access.md)。

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm start` | 啟動 Dashboard |
| `npm run doctor` | 檢查目前電腦的執行環境 |
| `npm run check` | 檢查專案 JavaScript 語法 |
| `npm run install-browser` | 安裝 Playwright Chromium 與支援的 Linux 系統套件 |
| `npm run portal:status` | 檢查 Server ePortal 登入狀態 |
| `npm run login` | 使用有介面的 Playwright 登入流程 |
| `npm run deploy:configure` | 產生正式環境部署設定 |
| `npm run deploy:check` | 檢查正式環境設定是否完整 |

## 可選設定

一般本機使用不需要修改設定。

需要時可以透過環境變數調整：

```bash
PORT=4174
HOST=0.0.0.0
EPORTAL_KEEPALIVE_MINUTES=10
EPORTAL_LOGIN_BRIDGE_TTL_MINUTES=15
```

如果使用 systemd、PM2、Docker 或其他程序管理工具，建議設定：

```bash
EPORTAL_RESTART_MODE=exit
```

正式 Cloudflare Access 部署還需要：

```bash
CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
```

## 資料與隱私

ePortal 的持久登入狀態會保存在本機：

```text
.eportal-profile/
```

Dashboard 的顯示名稱、頭像與自訂背景則會保存在：

```text
data/
```

透過 Login Bridge 輸入的密碼與 MFA 驗證資訊，設計上只會暫存在記憶體中，不會刻意寫入應用程式 log 或偏好設定檔。

請勿 commit 或分享：

- `.eportal-profile/`
- Cookies 或匯出的瀏覽器 session
- JWT / SSO Token
- Login Bridge Token
- 正式環境的私人設定檔

## 進階文件

- [Cloudflare Access 部署](docs/cloudflare-access.md)
- [Userscript / Client Browser 整合](docs/userscript.md)

大多數使用者只需要完成 **快速開始** 與 **第一次登入**，就可以開始使用。
