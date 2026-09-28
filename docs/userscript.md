# NUTC Portal Userscript

NUTC Portal 的互動式 ePortal 登入完全發生在使用者目前的瀏覽器。

普通 Dashboard 網頁無法跨網域讀取 `eportal.nutc.edu.tw` 的 DOM，因此 repo 內提供一個 userscript，只負責偵測官方 ePortal 是否已登入並通知 Dashboard。

## 安裝 / 更新

直接從 Dashboard 開啟：

```text
/userscript/nutc-portal.user.js
```

或從 repository 的：

```text
public/userscript/nutc-portal.user.js
```

安裝到支援 userscript 的管理器。

userscript metadata 已包含 `@updateURL` / `@downloadURL`，支援自動更新的 userscript manager 可自行檢查新版。

## Mobile flow

Dashboard 會把一次性 nonce 與 return URL 放在 ePortal URL fragment。

登入成功後：

- 若瀏覽器保留 `window.opener`，userscript 用 `postMessage` 通知原 Dashboard。
- 若行動瀏覽器沒有 opener，userscript 直接導回 Dashboard。
- 如果登入是由某個模組卡片觸發，回到 Dashboard 後會自動接著進入該模組。

## Scope

Userscript 僅執行於：

```text
https://eportal.nutc.edu.tw/*
```

目前使用 `@grant none`，不需要 browser-extension cookie API，也不讀取 HttpOnly cookie。

它只根據登入後頁面狀態判斷成功，然後通知 Dashboard。

因此它適合桌面與支援 userscript 的行動瀏覽器，而且不需要 server-side Chromium / noVNC。


## Preference sync

After ePortal login is confirmed, the userscript collects preference-like values from
`localStorage` and `sessionStorage` and sends them through the Dashboard bridge to
`/api/sync`.

Keys that look like authentication/session material are excluded on both the userscript
and server sides. The persisted file is `data/preferences.json`, which is ignored by Git.
