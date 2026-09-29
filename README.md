<!-- **FOR AGENTS**: **DO NOT** modify the warning text. keep it **AS IS**. -->

> [!WARNING]
> **VIBE CODE REPO AHEAD!**
> 
> This project is entirely vibe coded with GPT-5.5 and GPT-5.6 Sol. Support and bug fixes are not guaranteed. Use at your own risk.


# NUTC Portal

A self-hosted personal dashboard for National Taichung University of Science and Technology (NUTC).

It gives you one place to view your class schedule and absence records, open common ePortal systems, and keep a reusable server-side ePortal session for SSO launches.

This is an unofficial personal project and is not affiliated with NUTC.

## What it includes

- Weekly class schedule from NUTC AIS
- Absence / attendance records from NUTC AIS
- Quick access to Student Management, WebMail, Activity Registration, EP, and TronClass
- Browser-based Server ePortal login and re-login
- Automatic ePortal session keepalive
- Theme colors, custom background, profile name, and avatar
- Responsive desktop and mobile dashboard
- Optional Cloudflare Access protection for an internet-facing deployment

## Quick start

### Requirements

- Node.js 18 or newer
- npm
- An NUTC ePortal account
- Internet access from the machine running the server

Clone the project and install it:

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot

npm install
npm run install-browser
npm run doctor
```

Start the dashboard:

```bash
npm start
```

Then open:

```text
http://localhost:4174
```

Cloudflare Access is not required for local use.

On Linux, `npm run install-browser` also installs the Chromium runtime dependencies when the operating system is supported.

## First login

After opening the dashboard, use **登入 Server ePortal**.

The login page controls a server-side Playwright browser and saves the authenticated session in:

```text
.eportal-profile/
```

You do not need a graphical desktop on the server. The login flow works from a phone or another computer through the dashboard itself.

Once login succeeds, the dashboard can load AIS data and create SSO handoffs for supported ePortal systems.

> [!IMPORTANT]
> `.eportal-profile/` contains authenticated browser state. Treat it like a credential. Do not commit it, publish it, or copy it to an untrusted machine.

## Running on another machine

For a home server, Raspberry Pi, VPS, or other always-on computer, the basic setup is the same:

```bash
git clone https://github.com/Rynowastaken/eportal-bot.git
cd eportal-bot
npm install
npm run install-browser
npm run doctor
npm start
```

By default the app uses port `4174`.

You can change the listener with environment variables:

```bash
HOST=0.0.0.0 PORT=4174 npm start
```

If the machine is only for your local network, protect access to it appropriately and avoid exposing port `4174` directly to the public internet.

## Public / internet-facing deployment

The recommended production setup is:

```text
Internet
  ↓
Cloudflare Access
  ↓
Caddy HTTPS reverse proxy
  ↓
NUTC Portal on 127.0.0.1:4174
```

For a Linux server with a domain name, first complete the normal installation above, then run:

```bash
npm run deploy:configure
```

The deployment wizard asks for your hostname, Cloudflare Access settings, Linux service account, Node path, and TLS certificate paths. It generates deployment files under `.deploy/`.

After reviewing them, they can be installed with:

```bash
sudo npm run deploy:configure -- --install
```

Then validate and start the services:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now eportal-bot
sudo systemctl reload caddy
```

You still need to configure the Cloudflare DNS record, Cloudflare Access application, and Origin CA certificate in your own Cloudflare account.

For the complete production walkthrough, see [docs/cloudflare-access.md](docs/cloudflare-access.md).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the dashboard |
| `npm run doctor` | Check the local environment |
| `npm run check` | Run JavaScript syntax checks |
| `npm run install-browser` | Install Playwright Chromium and supported Linux dependencies |
| `npm run portal:status` | Check the saved server ePortal session |
| `npm run login` | Open the fallback headed ePortal login flow |
| `npm run deploy:configure` | Generate production deployment files |
| `npm run deploy:check` | Validate production environment settings |

## Optional settings

The defaults should work for normal local use. These environment variables are available when needed:

```bash
PORT=4174
HOST=0.0.0.0
EPORTAL_KEEPALIVE_MINUTES=10
EPORTAL_LOGIN_BRIDGE_TTL_MINUTES=15
```

For a systemd/PM2/Docker-style supervised process, use:

```bash
EPORTAL_RESTART_MODE=exit
```

Production Cloudflare Access deployments additionally use:

```bash
CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
```

## Data and privacy

The application stores its persistent ePortal browser session locally in `.eportal-profile/`.

Dashboard preferences such as the profile name, avatar, and custom background are stored under `data/`.

Passwords and MFA values entered through the login bridge are intended to remain in memory only and are not intentionally written to application logs or preference files.

Do not commit or share:

- `.eportal-profile/`
- cookies or exported browser state
- JWT / SSO tokens
- login bridge tokens
- private deployment environment files

## More documentation

- [Cloudflare Access deployment](docs/cloudflare-access.md)
- [Userscript / client-browser integration](docs/userscript.md)

For most users, the steps in **Quick start** and **First login** are all that is required.
