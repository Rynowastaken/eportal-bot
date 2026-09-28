// ==UserScript==
// @name         NUTC Portal Bridge
// @namespace    https://github.com/Rynowastaken/eportal-bot
// @version      0.3.0
// @description  Detect official NUTC ePortal login and notify the NUTC Portal dashboard.
// @author       Rynowastaken
// @match        https://eportal.nutc.edu.tw/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Rynowastaken/eportal-bot/main/public/userscript/nutc-portal.user.js
// @downloadURL  https://raw.githubusercontent.com/Rynowastaken/eportal-bot/main/public/userscript/nutc-portal.user.js
// ==/UserScript==

(() => {
  "use strict";

  const SOURCE = "nutc-portal-userscript";
  const MODE_KEY = "nutcPortalBridgeMode";
  const NONCE_KEY = "nutcPortalBridgeNonce";
  const RETURN_KEY = "nutcPortalBridgeReturn";
  const STUDENT_SELECTOR = 'button[onclick*="NUTC_6401"]';

  let lastNotification = null;

  const SENSITIVE_KEY =
    /(^|[_:.-])(auth|token|cookie|session|jwt|secret|password|passwd|credential|sso|csrf|xsrf|aspnet|asp\.net)([_:.-]|$)/i;
  const PREFERENCE_KEY =
    /(^|[_:.-])(theme|layout|ui|pref|preference|setting|settings|locale|language|lang|sidebar|dashboard|display|density|compact|sort|order|view|color|font|mode)([_:.-]|$)/i;

  function collectPreferenceBucket(storage) {
    const output = {};

    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || key.length > 128) continue;
        if (SENSITIVE_KEY.test(key) || !PREFERENCE_KEY.test(key)) continue;

        const value = storage.getItem(key);
        if (typeof value !== "string" || value.length > 8192) continue;
        output[key] = value;
      }
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }

    return output;
  }

  function collectPreferences() {
    return {
      localStorage: collectPreferenceBucket(localStorage),
      sessionStorage: collectPreferenceBucket(sessionStorage),
    };
  }

  function encodePreferences(value) {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    } catch {
      return "";
    }
  }

  function safeSessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Hardened/private browser modes may restrict sessionStorage.
    }
  }

  function safeSessionGet(key) {
    try {
      return sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function readBridgeState() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));

    const explicitMode = hash.get("nutc-portal-bridge") || "";
    const explicitNonce = hash.get("nutc-portal-nonce") || "";
    const explicitReturn = hash.get("nutc-portal-return") || "";

    if (explicitMode) safeSessionSet(MODE_KEY, explicitMode);
    if (explicitNonce) safeSessionSet(NONCE_KEY, explicitNonce);
    if (explicitReturn) safeSessionSet(RETURN_KEY, explicitReturn);

    const state = {
      mode: explicitMode || safeSessionGet(MODE_KEY),
      nonce: explicitNonce || safeSessionGet(NONCE_KEY),
      returnUrl: explicitReturn || safeSessionGet(RETURN_KEY),
    };

    if (explicitMode || explicitNonce || explicitReturn) {
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch {
        // The fragment is harmless if it cannot be removed.
      }
    }

    return state;
  }

  function isLoggedIn() {
    if (location.hostname !== "eportal.nutc.edu.tw") return false;
    if (location.pathname.startsWith("/nutc_dashboard/")) return true;
    return Boolean(document.querySelector(STUDENT_SELECTOR));
  }

  function validReturnUrl(rawUrl) {
    if (!rawUrl) return null;

    try {
      const url = new URL(rawUrl);
      if (url.protocol === "https:") return url;

      const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
      if (url.protocol === "http:" && localHosts.has(url.hostname)) return url;
    } catch {
      // Invalid return URL.
    }

    return null;
  }

  function notifyLoggedIn(state) {
    if (!state.mode || !state.nonce) return;
    if (lastNotification === state.nonce) return;

    lastNotification = state.nonce;

    const preferences = collectPreferences();
    const payload = {
      source: SOURCE,
      type: "auth-status",
      loggedIn: true,
      nonce: state.nonce,
      preferences,
      ts: Date.now(),
    };

    let openerNotified = false;

    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, "*");
        openerNotified = true;
      }
    } catch {
      openerNotified = false;
    }

    if (!openerNotified) {
      const returnUrl = validReturnUrl(state.returnUrl);
      if (returnUrl) {
        returnUrl.searchParams.set("eportalAuth", "ok");
        returnUrl.searchParams.set("nonce", state.nonce);

        const encodedPreferences = encodePreferences(preferences);
        if (encodedPreferences && encodedPreferences.length < 6000) {
          const hash = new URLSearchParams(returnUrl.hash.replace(/^#/, ""));
          hash.set("nutc-sync", encodedPreferences);
          returnUrl.hash = hash.toString();
        }

        location.replace(returnUrl.toString());
      }
    }
  }

  function check() {
    const state = readBridgeState();
    if (!state.mode || !state.nonce) return;

    if (isLoggedIn()) {
      notifyLoggedIn(state);
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

  const timer = window.setInterval(check, 750);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      observer.disconnect();
    },
    { once: true },
  );
})();
