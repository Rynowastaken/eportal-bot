# Platform support

NUTC Portal separates the **single persistent Chromium session** from the way you view that browser.

Run this first on any host:

```bash
npm run doctor
```

It reports the OS, architecture, graphical display, Chromium override, VNC/noVNC availability, and the login mode that will be used.

## Login modes

### `auto` (default)

- Linux: uses embedded noVNC when a usable local stack is available; otherwise uses the host display.
- macOS / Windows: uses the host desktop unless `PORTAL_NOVNC_TARGET` is configured.

### `host`

Chromium opens on the host's normal desktop. The ePortal session is still the same persistent profile used by SSO and scraping.

```bash
PORTAL_LOGIN_MODE=host npm start
```

### `novnc`

Requires either:

- Linux tools: Xvfb (when no display exists), x11vnc, websockify, and a noVNC web root containing `vnc.html`; or
- an external noVNC bridge supplied with `PORTAL_NOVNC_TARGET`.

```bash
PORTAL_LOGIN_MODE=novnc \
PORTAL_NOVNC_TARGET=http://127.0.0.1:6080 \
npm start
```

## Linux

The launcher does not assume Debian. Install equivalent packages from your distribution for:

- Xvfb, only when the machine has no graphical display
- x11vnc
- websockify
- noVNC

Common noVNC locations are detected automatically. Override with:

```bash
PORTAL_NOVNC_WEB=/path/to/novnc npm start
```

If `DISPLAY` or `WAYLAND_DISPLAY` already exists, the launcher does not start Xvfb.

## macOS and Windows

The persistent Chromium session works with the normal desktop session.

For a Dashboard-embedded remote login, run a VNC/noVNC bridge appropriate for the OS and point NUTC Portal at it:

```bash
PORTAL_NOVNC_TARGET=http://127.0.0.1:6080 npm start
```

Without that setting, login mode falls back to `host`.

## Chromium

By default Playwright uses its managed Chromium. A system browser can be selected with a full executable path:

```bash
PORTAL_CHROMIUM=/path/to/chromium npm start
```

This is useful on architectures where Playwright's bundled browser is unavailable.

## Useful overrides

```text
PORTAL_LOGIN_MODE=auto|novnc|host
PORTAL_CHROMIUM=/absolute/path/to/chromium
PORTAL_NOVNC_TARGET=http://127.0.0.1:6080
PORTAL_NOVNC_WEB=/path/to/novnc
PORTAL_DISPLAY=:99
PORTAL_VNC_PORT=5900
PORTAL_NOVNC_PORT=6080
HOST=127.0.0.1
PORT=4173
```

When using Cloudflare Access, keep the origin private. Only the NUTC Portal HTTP port should be reachable by the tunnel.
