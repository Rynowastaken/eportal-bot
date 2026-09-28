(() => {
  const SOURCE = "nutc-portal-bridge";
  const MODE_KEY = "nutcPortalBridgeMode";
  const STUDENT_SELECTOR = 'button[onclick*="NUTC_6401"]';

  function readMode() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const explicit = hash.get("nutc-portal-bridge");
    if (explicit) {
      try {
        sessionStorage.setItem(MODE_KEY, explicit);
      } catch {
        // sessionStorage may be unavailable in hardened browser contexts.
      }
      return explicit;
    }

    try {
      return sessionStorage.getItem(MODE_KEY) || "";
    } catch {
      return "";
    }
  }

  function isLoggedIn() {
    if (location.hostname !== "eportal.nutc.edu.tw") return false;

    if (location.pathname.startsWith("/nutc_dashboard/")) return true;

    return Boolean(document.querySelector(STUDENT_SELECTOR));
  }

  function notifyLoggedIn() {
    const payload = {
      source: SOURCE,
      type: "auth-status",
      loggedIn: true,
      href: location.href,
      ts: Date.now(),
    };

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, "*");
      }
    } catch {
      // Cross-origin opener access is intentionally limited; postMessage is best effort.
    }

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch {
      // Best effort for embedded checks.
    }
  }

  function check() {
    const mode = readMode();
    if (!mode) return;

    if (isLoggedIn()) {
      notifyLoggedIn();
    }
  }

  check();

  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("pageshow", check);
  window.addEventListener("load", check);

  const timer = setInterval(check, 750);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
