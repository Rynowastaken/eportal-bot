# ePortal → AIS automation

This helper reuses a Playwright authentication state instead of hard-coding passwords or scraping Chrome's cookie database.

## Install on Raspberry Pi

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

On Raspberry Pi OS, Playwright's Chromium support can vary by OS release/architecture. If browser installation fails, install a Playwright-supported Chromium environment or run the script in a supported Linux container/host.

## First login

```bash
python3 eportal_bot.py login
```

A Chromium window opens. Log into ePortal normally. Once the Student Management button appears, the script saves `eportal-auth-state.json`.

Treat this file like a password/session credential. The script attempts to chmod it to `0600`.

## Automated run

```bash
python3 eportal_bot.py run
```

The script:

1. Loads the saved Playwright authentication state.
2. Verifies the ePortal dashboard still shows the `NUTC_6401` Student Management entry.
3. Opens `https://eportal.nutc.edu.tw/?app_id=NUTC_6401`.
4. Lets the site's normal SSO flow redirect to `ais.nutc.edu.tw`.
5. Saves the authenticated AIS landing page to `output/ais_landing.html`.
6. Saves any refreshed browser state back into `eportal-auth-state.json`.

## Fetch an AIS endpoint after SSO

After you identify the URL used to load your timetable:

```bash
python3 eportal_bot.py run --fetch-url 'https://ais.nutc.edu.tw/student/REPLACE_WITH_TIMETABLE_ENDPOINT'
```

The request is sent through Playwright's BrowserContext request API, which shares the browser context's cookie jar. No cookie values are extracted or printed.

Output is saved under `output/`.

## Cron example

Use an absolute path to your virtualenv Python:

```cron
15 6 * * * /home/pi/eportal-bot/.venv/bin/python /home/pi/eportal-bot/eportal_bot.py run >> /home/pi/eportal-bot/eportal.log 2>&1
```

If the server-side login session expires, `run` exits and asks you to perform the one-time `login` step again.
