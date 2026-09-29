const motion = window.NutcMotion;
const launchTitle = document.querySelector("#launchTitle");
const launchDescription = document.querySelector("#launchDescription");
const launchElapsed = document.querySelector("#launchElapsed");
const launchStage = document.querySelector("#launchStage");
const launchDetail = document.querySelector("#launchDetail");
const launchLog = document.querySelector("#launchLog");
const launchTarget = document.querySelector("#launchTarget");
const launchSpinner = document.querySelector("#launchSpinner");
const launchError = document.querySelector("#launchError");
const launchErrorMessage = document.querySelector("#launchErrorMessage");
const launchRetry = document.querySelector("#launchRetry");
const launchLogin = document.querySelector("#launchLogin");
const launchBack = document.querySelector("#launchBack");

const moduleId =
  location.pathname.match(/^\/go\/([a-z0-9-]+)$/)?.[1] || "";

let startedAt = performance.now();
let elapsedTimer = null;
let lastStageKey = "";
let activeJobId = "";
let stopped = false;

const stageLabels = {
  queued: "request accepted",
  "profile-check": "profile check",
  "profile-lock": "profile lock",
  "browser-launch": "Chromium launch",
  "browser-ready": "browser ready",
  "dashboard-load": "ePortal dashboard",
  "session-valid": "session verified",
  "handoff-probe": "HTTP SSO probe",
  "handoff-browser": "browser discovery",
  "module-request": "module request",
  "handoff-captured": "handoff captured",
  "activity-relay": "Activity relay",
  ready: "ready",
  error: "error",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error || `Request failed (${response.status})`,
    );
    error.code = data.code || "";
    throw error;
  }

  return data;
}

function startElapsedClock() {
  startedAt = performance.now();
  clearInterval(elapsedTimer);

  const update = () => {
    launchElapsed.textContent =
      ((performance.now() - startedAt) / 1000).toFixed(1) + "s";
  };

  update();
  elapsedTimer = window.setInterval(update, 100);
}

function stopElapsedClock() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function appendLog(stage, detail, elapsedMs = null) {
  const key = stage + "\n" + detail;
  if (key === lastStageKey) return;
  lastStageKey = key;

  const item = document.createElement("li");
  item.className =
    "grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-white/[.08] bg-white/[.035] px-3 py-2.5";

  const time = document.createElement("span");
  time.className =
    "pt-0.5 text-[10px] font-semibold tabular-nums text-[var(--faint)]";
  const seconds =
    elapsedMs == null
      ? (performance.now() - startedAt) / 1000
      : elapsedMs / 1000;
  time.textContent = seconds.toFixed(1) + "s";

  const body = document.createElement("span");
  body.className = "min-w-0";

  const name = document.createElement("strong");
  name.className =
    "block text-xs font-semibold text-[var(--foreground)]";
  name.textContent = stageLabels[stage] || stage;

  const copy = document.createElement("span");
  copy.className =
    "mt-0.5 block text-[11px] font-medium leading-5 text-[var(--muted)]";
  copy.textContent = detail;

  body.append(name, copy);
  item.append(time, body);
  launchLog.append(item);
  item.scrollIntoView({ block: "nearest" });

  void motion?.enter?.(item, {
    duration: 220,
    y: 5,
    scale: 0.995,
  });
}

function renderJob(job) {
  if (job.module) {
    launchTitle.textContent = `Opening ${job.module.shortName}`;
    launchDescription.textContent =
      job.module.description ||
      "Creating a secure server-side ePortal handoff for this browser.";
    document.title = `Opening ${job.module.shortName} · NUTC Portal`;
  }

  launchStage.textContent = stageLabels[job.stage] || job.stage;
  launchDetail.textContent =
    job.detail || "Server-side launch work is in progress.";

  if (job.target) {
    launchTarget.textContent = `Target: ${job.target}`;
  }

  appendLog(job.stage, job.detail || "", job.elapsedMs);

  if (job.state === "error") {
    showError(
      job.error?.message || job.detail || "Module launch failed.",
      job.error?.code || "",
    );
  }
}

function showError(message, code = "") {
  stopped = true;
  stopElapsedClock();
  launchSpinner.querySelector("svg")?.classList.remove("animate-spin");
  launchStage.textContent = "error";
  launchStage.classList.remove("text-[var(--accent)]");
  launchStage.classList.add("text-[#f4a0a5]");
  launchErrorMessage.textContent = message;
  launchError.classList.remove("hidden");
  launchLogin.classList.toggle(
    "hidden",
    code !== "EPORTAL_LOGIN_REQUIRED",
  );
  void motion?.enter?.(launchError, {
    duration: 240,
    y: 8,
    scale: 0.985,
  });
}

function submitHandoff(handoff) {
  if (handoff.type === "get") {
    location.replace(handoff.url);
    return;
  }

  if (handoff.type !== "post") {
    throw new Error("Unsupported SSO handoff type.");
  }

  const form = document.createElement("form");
  form.method = "post";
  form.action = handoff.url;
  form.enctype =
    handoff.enctype || "application/x-www-form-urlencoded";
  form.referrerPolicy = "no-referrer";

  for (const [name, value] of handoff.fields || []) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = String(name);
    input.value = String(value);
    form.append(input);
  }

  document.body.append(form);
  form.submit();
}

async function consumeJob(jobId) {
  launchStage.textContent = "transferring";
  launchDetail.textContent =
    "Consuming the one-time handoff and transferring control to the target system.";
  appendLog(
    "ready",
    "One-time SSO material is ready; handing it to this browser.",
  );

  const data = await request(
    `/api/launch-job/${encodeURIComponent(jobId)}/consume`,
    { method: "POST" },
  );

  stopElapsedClock();
  launchSpinner.querySelector("svg")?.classList.remove("animate-spin");
  submitHandoff(data.handoff);
}

async function pollJob(jobId) {
  while (!stopped) {
    const data = await request(
      `/api/launch-job/${encodeURIComponent(jobId)}`,
    );
    const job = data.job;
    renderJob(job);

    if (job.state === "ready") {
      await consumeJob(jobId);
      return;
    }

    if (job.state === "error") return;
    await sleep(250);
  }
}

async function startLaunch() {
  stopped = false;
  activeJobId = "";
  lastStageKey = "";
  launchLog.replaceChildren();
  launchError.classList.add("hidden");
  launchLogin.classList.add("hidden");
  launchStage.classList.remove("text-[#f4a0a5]");
  launchStage.classList.add("text-[var(--accent)]");
  launchSpinner.querySelector("svg")?.classList.add("animate-spin");
  launchTarget.textContent = "";
  startElapsedClock();

  appendLog(
    "queued",
    `POST /api/launch/${moduleId || "unknown"} — requesting a progress-tracked launch job.`,
    0,
  );

  try {
    if (!moduleId) {
      throw new Error("The module ID is missing from this launch URL.");
    }

    const data = await request(
      `/api/launch/${encodeURIComponent(moduleId)}`,
      { method: "POST" },
    );

    activeJobId = data.job.id;
    renderJob(data.job);
    await pollJob(activeJobId);
  } catch (error) {
    showError(error?.message || String(error), error?.code || "");
  }
}

launchRetry.addEventListener("click", () => {
  void startLaunch();
});

launchLogin.addEventListener("click", () => {
  location.assign("/server-login/");
});

launchBack.addEventListener("click", () => {
  location.assign("/");
});

(async () => {
  await window.NutcTheme.init();
  window.lucide?.createIcons?.();
  void motion?.enter?.(document.querySelector("main > section"), {
    duration: 300,
    y: 10,
    scale: 0.985,
  });
  await startLaunch();
})();
