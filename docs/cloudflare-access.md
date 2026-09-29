# Deploy behind Cloudflare Access

NUTC Portal can use Cloudflare Access as its outer authentication layer. The application
also validates the Access JWT at the origin, so a request that reaches port 4174 without
a valid Access assertion is not allowed to see the Dashboard or call its APIs.

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
NUTC Portal validates issuer + AUD using Cloudflare JWKS
  ↓
302 /
  ↓
Dashboard / APIs / login bridge / launch routes
```

The only route intended to be public is `/login`. It is a self-contained page: it does
not load the stored account picture, background, preferences, JavaScript, or private API
data.

## 1. Publish port 4174 through Cloudflare Tunnel

Point a Cloudflare Tunnel public hostname at the local server:

```text
portal.example.com -> http://localhost:4174
```

Do not expose port 4174 directly to the Internet if you can avoid it.

## 2. Create the protected Access application

In Cloudflare Zero Trust, create a **Self-hosted and private** Access application for
your Portal hostname, for example:

```text
portal.example.com
```

Add an **Allow** policy that matches only the identities that should use the Portal
(for example, your specific email address or an approved identity-provider group).

Copy these two values from Cloudflare:

- your team domain, such as `https://my-team.cloudflareaccess.com`
- the application's **Application Audience (AUD) Tag**

## 3. Leave only /login public

The branded login page must be reachable before authentication. Create a more-specific
Access application/path for:

```text
portal.example.com/login*
```

and give that path a **Bypass / Everyone** policy, or use the equivalent public path
override in the Access application.

Keep the bypass limited to `/login*`. Do not bypass `/api/*`, `/auth/start`,
`/server-login/*`, `/go/*`, or the root application.

The application itself still refuses unauthenticated requests on every route except
`/login` and `/login/`, so a broader accidental Cloudflare bypass will not expose
the Dashboard when origin JWT enforcement is enabled.

## 4. Configure origin JWT verification

Set these environment variables for the Node process:

```bash
CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://my-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
```

Then install dependencies and verify the deployment:

```bash
npm install
npm run doctor
npm start
```

With enforcement enabled, startup reports that Cloudflare Access JWT validation is
enabled. If either the team domain or AUD is missing, the server refuses to start
instead of silently running without the origin gate.

Multiple AUD values can be supplied as a comma-separated list if the same origin needs
to accept more than one Access application:

```bash
CLOUDFLARE_ACCESS_AUD=aud-one,aud-two
```

## 5. Test the gate

Use a browser with no existing Cloudflare Access session.

1. Open `https://portal.example.com/login`.
2. The NUTC Portal branded sign-in page should appear.
3. Press **Continue with Cloudflare Access**.
4. Cloudflare should authenticate you and evaluate the Access policy.
5. A successful policy sends you back through `/auth/start`, then the Dashboard opens.
6. A user who does not satisfy the Access policy never reaches the protected application.

To test origin protection, a request made directly to the Node origin without a valid
`Cf-Access-Jwt-Assertion` must be rejected or redirected to `/login`.

## Logout

Cloudflare Access provides its own application logout endpoint:

```text
https://portal.example.com/cdn-cgi/access/logout
```

This is separate from the ePortal server-session logout inside NUTC Portal.

## Local development

Leave `CLOUDFLARE_ACCESS_ENFORCE` unset while developing directly on
`http://localhost:4174`. The Portal continues to work locally without a Cloudflare
JWT. Enable enforcement only for the deployed process that sits behind Access.
