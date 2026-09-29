import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

function normalizeTeamDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    return new URL(raw).origin;
  }

  const host = raw.includes(".")
    ? raw
    : `${raw}.cloudflareaccess.com`;

  return `https://${host.replace(/\/$/, "")}`;
}

function normalizeAudiences(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function wantsHtml(req) {
  if (!["GET", "HEAD"].includes(String(req.method || "").toUpperCase())) {
    return false;
  }

  const accept = String(req.headers.accept || "");
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

export function createCloudflareAccessGuard({
  enforce = false,
  teamDomain = "",
  audience = "",
} = {}) {
  const normalizedTeamDomain = normalizeTeamDomain(teamDomain);
  const audiences = normalizeAudiences(audience);
  const configured = Boolean(
    normalizedTeamDomain && audiences.length,
  );
  const enabled = Boolean(enforce);

  if (enabled && !configured) {
    throw new Error(
      "CLOUDFLARE_ACCESS_ENFORCE=1 requires CLOUDFLARE_ACCESS_TEAM_DOMAIN and CLOUDFLARE_ACCESS_AUD.",
    );
  }

  const jwks = configured
    ? createRemoteJWKSet(
        new URL(
          `${normalizedTeamDomain}/cdn-cgi/access/certs`,
        ),
      )
    : null;

  async function verify(req) {
    if (!enabled) {
      return {
        ok: true,
        enforced: false,
        payload: null,
      };
    }

    const token = String(
      req.headers["cf-access-jwt-assertion"] || "",
    ).trim();

    if (!token) {
      return {
        ok: false,
        enforced: true,
        status: 401,
        code: "CF_ACCESS_MISSING",
        message: "Cloudflare Access authentication is required.",
      };
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: normalizedTeamDomain,
        audience:
          audiences.length === 1 ? audiences[0] : audiences,
      });

      return {
        ok: true,
        enforced: true,
        payload,
      };
    } catch (error) {
      return {
        ok: false,
        enforced: true,
        status: 401,
        code: "CF_ACCESS_INVALID",
        message: "Cloudflare Access session is invalid or expired.",
        cause: error?.message || String(error),
      };
    }
  }

  function publicInfo() {
    return {
      enabled,
      configured,
      teamDomain: normalizedTeamDomain || null,
      audienceCount: audiences.length,
    };
  }

  return {
    enabled,
    configured,
    verify,
    wantsHtml,
    publicInfo,
  };
}
