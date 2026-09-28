#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NAME="${PORTAL_DISPLAY:-:99}"
VNC_PORT="${PORTAL_VNC_PORT:-5900}"
NOVNC_PORT="${PORTAL_NOVNC_PORT:-6080}"
NOVNC_WEB="${PORTAL_NOVNC_WEB:-/usr/share/novnc}"

required=(Xvfb x11vnc websockify)
for cmd in "${required[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    echo "Install Raspberry Pi packages: sudo apt install xvfb x11vnc novnc websockify" >&2
    exit 1
  fi
done

if [[ ! -d "$NOVNC_WEB" ]]; then
  echo "noVNC web root not found: $NOVNC_WEB" >&2
  echo "Set PORTAL_NOVNC_WEB if your distro installs noVNC elsewhere." >&2
  exit 1
fi

pids=()

cleanup() {
  trap - EXIT INT TERM
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

Xvfb "$DISPLAY_NAME"   -screen 0 1280x800x24   -nolisten tcp   -ac   >/tmp/nutc-portal-xvfb.log 2>&1 &
pids+=("$!")

sleep 0.4

x11vnc   -display "$DISPLAY_NAME"   -localhost   -forever   -shared   -nopw   -rfbport "$VNC_PORT"   -quiet   >/tmp/nutc-portal-x11vnc.log 2>&1 &
pids+=("$!")

websockify   --web="$NOVNC_WEB"   "127.0.0.1:$NOVNC_PORT"   "127.0.0.1:$VNC_PORT"   >/tmp/nutc-portal-websockify.log 2>&1 &
pids+=("$!")

export DISPLAY="$DISPLAY_NAME"

node server.js
