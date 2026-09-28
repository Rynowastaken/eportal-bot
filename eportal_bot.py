#!/usr/bin/env python3
"""
ePortal -> NUTC_6401 -> AIS automation helper.

Usage:
  1) First login (interactive):
     python3 eportal_bot.py login

  2) Automated SSO check (headless):
     python3 eportal_bot.py run

  3) Optional: fetch an authenticated AIS URL after SSO:
     python3 eportal_bot.py run --fetch-url 'https://ais.nutc.edu.tw/student/...'

Notes:
- This script does not scrape Chrome's cookie database and does not hard-code passwords.
- Authentication state is stored in eportal-auth-state.json. Treat that file like a credential.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

EPORTAL_HOME = "https://eportal.nutc.edu.tw/"
EPORTAL_DASHBOARD = "https://eportal.nutc.edu.tw/nutc_dashboard/"
EPORTAL_STUDENT_SSO = "https://eportal.nutc.edu.tw/?app_id=NUTC_6401"
AIS_HOST = "ais.nutc.edu.tw"

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "eportal-auth-state.json"
OUTPUT_DIR = BASE_DIR / "output"

# From the saved ePortal page you provided.
STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]'


def secure_state_file(path: Path) -> None:
    """Best-effort chmod 600 on Unix-like systems."""
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def save_state(context) -> None:
    context.storage_state(path=str(STATE_FILE))
    secure_state_file(STATE_FILE)


def is_eportal_logged_in(page) -> bool:
    """Check for a post-login element rather than inspecting cookie values."""
    try:
        page.goto(EPORTAL_DASHBOARD, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(800)
        return page.locator(STUDENT_BUTTON_SELECTOR).count() > 0
    except PlaywrightTimeoutError:
        return False


def first_login() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(EPORTAL_HOME, wait_until="domcontentloaded", timeout=30000)

        print("[+] Browser opened. Log in to ePortal normally.")
        print("[+] Waiting until the Student Management button appears...")

        try:
            page.wait_for_selector(STUDENT_BUTTON_SELECTOR, timeout=0)
        except KeyboardInterrupt:
            browser.close()
            return 130

        save_state(context)
        print(f"[+] Login state saved to: {STATE_FILE}")
        print("[!] Keep this file private; it contains authentication state.")
        browser.close()
        return 0


def open_ais_via_sso(page) -> None:
    """Use the application's normal SSO entry point and follow redirects."""
    page.goto(EPORTAL_STUDENT_SSO, wait_until="domcontentloaded", timeout=30000)

    try:
        page.wait_for_url(lambda url: url.hostname == AIS_HOST, timeout=20000)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(
            "SSO did not reach ais.nutc.edu.tw. The ePortal state may have expired, "
            "or the SSO flow may have changed."
        ) from exc


def fetch_authenticated(context, url: str, method: str = "GET", data: Optional[dict] = None):
    """
    Issue a request through the BrowserContext's shared cookie jar.
    This avoids extracting or printing session cookies.
    """
    api = context.request
    method = method.upper()

    if method == "GET":
        return api.get(url, timeout=30000)
    if method == "POST":
        return api.post(url, form=data or {}, timeout=30000)

    raise ValueError("Only GET and POST are supported by this helper.")


def run(fetch_url: Optional[str], headed: bool) -> int:
    if not STATE_FILE.exists():
        print(f"[-] Missing {STATE_FILE}")
        print("    Run: python3 eportal_bot.py login")
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context(storage_state=str(STATE_FILE))
        page = context.new_page()

        if not is_eportal_logged_in(page):
            print("[-] Saved ePortal login state is no longer valid.")
            print("    Re-run: python3 eportal_bot.py login")
            browser.close()
            return 3

        print("[+] ePortal login state is valid.")

        try:
            open_ais_via_sso(page)
        except RuntimeError as exc:
            print(f"[-] {exc}")
            browser.close()
            return 4

        print(f"[+] AIS SSO completed: {page.url}")

        # Save the authenticated landing page for inspection/debugging.
        html_path = OUTPUT_DIR / "ais_landing.html"
        html_path.write_text(page.content(), encoding="utf-8")
        print(f"[+] Saved AIS landing HTML: {html_path}")

        # Persist cookies/storage refreshed during the SSO flow.
        save_state(context)

        if fetch_url:
            if not fetch_url.startswith("https://ais.nutc.edu.tw/"):
                print("[-] --fetch-url must stay under https://ais.nutc.edu.tw/")
                browser.close()
                return 5

            response = fetch_authenticated(context, fetch_url)
            body = response.body()
            out_path = OUTPUT_DIR / "authenticated_response.bin"
            out_path.write_bytes(body)

            meta = {
                "url": fetch_url,
                "status": response.status,
                "ok": response.ok,
                "headers": response.headers,
                "body_file": str(out_path),
            }
            meta_path = OUTPUT_DIR / "authenticated_response.json"
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

            print(f"[+] Authenticated request status: {response.status}")
            print(f"[+] Response saved to: {out_path}")
            print(f"[+] Metadata saved to: {meta_path}")

        browser.close()
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Automate ePortal -> AIS SSO using Playwright state.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("login", help="Open a browser for one-time manual login and save auth state.")

    run_parser = sub.add_parser("run", help="Reuse saved state and perform ePortal -> AIS SSO.")
    run_parser.add_argument(
        "--fetch-url",
        help="Optional authenticated AIS URL to fetch after SSO.",
    )
    run_parser.add_argument(
        "--headed",
        action="store_true",
        help="Show the Chromium window instead of running headless.",
    )

    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.command == "login":
        return first_login()
    if args.command == "run":
        return run(args.fetch_url, args.headed)

    return 1


if __name__ == "__main__":
    sys.exit(main())
