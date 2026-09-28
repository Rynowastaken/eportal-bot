# Client login bridge

NUTC Portal intentionally keeps the official ePortal login inside the **user's own browser**.

A normal web page cannot read another site's cookies or DOM, so it cannot reliably detect that
`eportal.nutc.edu.tw` finished logging in. The small WebExtension in `extension/` bridges only
that status event.

## What the extension does

- runs only on `https://eportal.nutc.edu.tw/*`
- watches for the logged-in dashboard / Student Management button
- sends a `postMessage` to the Dashboard window that opened the login page
- never reads or stores the password
- never sends ePortal cookies to the NUTC Portal server

## Chromium / Edge

Open the browser's extensions page, enable developer mode, and load the repository's
`extension/` folder as an unpacked extension.

## Firefox

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select
`extension/manifest.json`.

For a permanent Firefox install, package/sign the same WebExtension normally.

## Login flow

1. Open NUTC Portal through Cloudflare Access.
2. Click **檢查 / 登入 ePortal** or any system card.
3. The Dashboard opens the official ePortal in a client-side popup.
4. Complete the official login if needed.
5. The extension detects the logged-in ePortal dashboard and notifies the opener.
6. The Dashboard immediately updates its status.
7. If a module card started the flow, the same popup is reused to open that module through ePortal SSO.

Without the extension, direct browser login and module redirects still work, but the Dashboard cannot
reliably auto-detect login success because of browser same-origin protections.
