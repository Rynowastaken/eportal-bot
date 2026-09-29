# Deploy behind Cloudflare Access

NUTC Portal can run behind Cloudflare Access **without Cloudflare Tunnel**. The intended
production layout is:

```text
Internet
  ↓ HTTPS
Cloudflare proxied DNS + Access
  ↓ HTTPS :443
Caddy on the server
  ↓ localhost only
NUTC Portal on 127.0.0.1:4174
```

The application also validates the Access JWT at the Node origin. A request that reaches
the reverse proxy without a valid `Cf-Access-Jwt-Assertion` cannot use the Dashboard,
APIs, login bridge, or SSO launch routes.

## Request flow

```text
browser
  ↓
GET /login                         public branded pre-auth page
  ↓ click Continue
GET /auth/start                    protected by Cloudflare Access
  ↓
Cloudflare Access / configured IdP
  ↓ policy passes
Cf-Access-Jwt-Assertion
  ↓
NUTC Portal validates signature + issuer + AUD
  ↓
302 /
  ↓
Dashboard / APIs / login bridge / launch routes
```

The only route intended to be public is `/login`. It is self-contained and does not
load the stored account picture, background, preferences, or private API data.

## 1. Keep Node private on localhost

Use the production environment template:

```bash
cp deploy/no-tunnel/eportal.env.example /etc/eportal-bot/eportal.env
```

Edit the Cloudflare values, but keep:

```text
HOST=127.0.0.1
PORT=4174
```

This prevents the Node process itself from listening on the public network interface.

The complete environment should contain:

```bash
HOST=127.0.0.1
PORT=4174
CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
EPORTAL_RESTART_MODE=exit
```

Run:

```bash
npm install
npm run doctor
npm run deploy:check
```

`deploy:check` fails if the production environment would expose Node directly or if
the required Access settings are missing.

## 2. Put Caddy on public HTTPS/443

A ready-to-edit example is included at:

```text
deploy/no-tunnel/Caddyfile.example
```

The important part is:

```caddyfile
portal.example.com {
    tls /etc/caddy/certs/portal-origin.pem /etc/caddy/certs/portal-origin-key.pem
    reverse_proxy 127.0.0.1:4174
}
```

Use a Cloudflare Origin CA certificate for the hostname and set Cloudflare SSL/TLS mode
to **Full (strict)**.

Do not expose port 4174 through the firewall/router. Only HTTPS/443 needs to reach
Caddy.

## 3. Cloudflare DNS

Create a DNS record for the Portal hostname, for example:

```text
portal.example.com -> YOUR_PUBLIC_IP
```

Keep the record **Proxied / orange-clouded**.

If your server is behind NAT, forward public TCP/443 to the machine running Caddy.
Port 4174 remains local-only and does not need a router port-forward.

## 4. Create the protected Access application

In Cloudflare Zero Trust, create a Self-hosted Access application for:

```text
portal.example.com
```

Add an **Allow** policy matching only the identities that should use the Portal, such
as your exact email address or an approved identity-provider group.

Copy:

- the team domain, e.g. `https://my-team.cloudflareaccess.com`
- the application's **Application Audience (AUD) Tag**

into `/etc/eportal-bot/eportal.env`.

## 5. Leave only /login public

The branded sign-in page must be reachable before Access authentication. Configure a
more-specific Access path for:

```text
portal.example.com/login*
```

and give only that path a Bypass/Everyone policy.

Do **not** bypass:

```text
/
/auth/start
/api/*
/go/*
/launch-job/*
/server-login/*
/activity-relay/*
```

The Node application independently verifies the Access JWT on those protected routes.

## 6. Run with systemd

A service template is included at:

```text
deploy/no-tunnel/eportal-bot.service.example
```

Copy it to:

```text
/etc/systemd/system/eportal-bot.service
```

and replace:

- `REPLACE_WITH_LINUX_USER`
- `REPLACE_WITH_LINUX_GROUP`
- `/REPLACE/WITH/eportal-bot`

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eportal-bot
sudo systemctl status eportal-bot
```

Because the production environment sets `EPORTAL_RESTART_MODE=exit`, the Dashboard's
Debug → Restart action exits cleanly and systemd starts a fresh process.

## 7. Test the gate

Use a private/incognito browser with no existing Access session.

1. Open `https://portal.example.com/login`.
2. The NUTC Portal branded sign-in page should appear.
3. Press **Continue with Cloudflare Access**.
4. Cloudflare authenticates you and evaluates the Access policy.
5. A successful policy returns through `/auth/start`.
6. The Node origin validates the signed Access JWT.
7. Only then is the Dashboard served.

A user that fails the Access policy never reaches the protected application.

A direct request to Caddy that lacks a valid Access JWT can see only the intentionally
public `/login` page; protected routes are rejected by Node even if Cloudflare is
bypassed.

## Optional extra origin hardening

The application-level JWT validation already protects the private routes from a direct
origin request. You can additionally harden the public HTTPS listener by:

- allowing inbound 443 only from Cloudflare proxy address ranges, or
- enabling Cloudflare Authenticated Origin Pulls / equivalent client-certificate
  validation at the reverse proxy.

Those measures are optional extra layers; do not remove origin JWT validation.

## Logout

Cloudflare Access has a separate application logout endpoint:

```text
https://portal.example.com/cdn-cgi/access/logout
```

This does not log out the server-side NUTC ePortal Playwright session.

## Local development

For direct local development, leave `CLOUDFLARE_ACCESS_ENFORCE` unset and run:

```bash
npm start
```

The Access gate stays disabled locally.
