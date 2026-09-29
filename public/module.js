const params = new URLSearchParams(location.search);
const moduleId = params.get("id") || "";

const moduleTitle = document.querySelector("#moduleTitle");
const moduleHeading = document.querySelector("#moduleHeading");
const moduleDescription = document.querySelector("#moduleDescription");
const officialLink = document.querySelector("#officialLink");
const statusDot = document.querySelector("#moduleStatusDot");
const statusTitle = document.querySelector("#moduleStatusTitle");
const statusDetail = document.querySelector("#moduleStatusDetail");
const refreshButton = document.querySelector("#refreshButton");
const content = document.querySelector("#content");

let moduleInfo = null;

function setStatus(state, title, detail) {
  statusDot.className = `status-dot ${state}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTable(table, index) {
  const card = el("article", "glass ais-table-card");
  card.append(
    el("h3", "ais-section-title", table.caption || `資料表 ${index + 1}`),
  );

  const wrap = el("div", "table-scroll");
  const tableEl = document.createElement("table");
  tableEl.className = "ais-table";

  for (const row of table.rows || []) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    tableEl.append(tr);
  }

  wrap.append(tableEl);
  card.append(wrap);
  return card;
}

function renderOverview(data) {
  content.replaceChildren();

  const summary = el("article", "info-card glass");
  const copy = el("div");
  copy.append(
    el("strong", "", data.title || moduleInfo?.name || "官方系統"),
    el(
      "p",
      "",
      `由 Server session 取得 · ${new Date(data.fetchedAt).toLocaleString()}`,
    ),
  );
  summary.append(copy);
  content.append(summary);

  if (data.headings?.length) {
    const card = el("article", "glass ais-text-card");
    card.append(el("h3", "ais-section-title", "頁面區塊"));
    const chips = el("div", "ais-chip-list");
    for (const heading of data.headings) {
      chips.append(el("span", "ais-chip", heading));
    }
    card.append(chips);
    content.append(card);
  }

  if (data.tables?.length) {
    data.tables.forEach((table, index) => {
      content.append(renderTable(table, index));
    });
    return;
  }

  if (data.text?.length) {
    const card = el("article", "glass ais-text-card");
    card.append(el("h3", "ais-section-title", "可見內容"));
    const list = el("div", "ais-text-list");
    for (const line of data.text.slice(0, 50)) {
      list.append(el("p", "", line));
    }
    card.append(list);
    content.append(card);
    return;
  }

  const empty = el("article", "info-card glass");
  const emptyCopy = el("div");
  emptyCopy.append(
    el("strong", "", "已登入，但沒有找到可顯示的內容"),
    el("p", "", "這個模組可能需要專用 selector 或額外互動才能顯示主要資料。"),
  );
  empty.append(emptyCopy);
  content.append(empty);
}

function renderError(message, needsLogin = false) {
  content.replaceChildren();
  const card = el("article", "info-card glass");
  const copy = el("div");
  copy.append(
    el(
      "strong",
      "",
      needsLogin ? "Server ePortal session 需要重新登入" : "模組載入失敗",
    ),
    el(
      "p",
      "",
      needsLogin
        ? "請在 Server 主機執行 npm run login，完成一次人工登入後再重新整理。"
        : message,
    ),
  );
  card.append(copy);
  content.append(card);
}

async function api(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function loadModuleInfo() {
  const { response, data } = await api("/api/modules");
  if (!response.ok) throw new Error(data.error || "Unable to load module list.");

  const found = data.modules?.find((entry) => entry.id === moduleId);
  if (!found) throw new Error("Unknown module.");

  moduleInfo = found;
  document.title = `${found.shortName} · NUTC Portal`;
  moduleTitle.textContent = found.shortName;
  moduleHeading.textContent = `使用 Server session 載入 ${found.name}。`;
  moduleDescription.textContent =
    `${found.description}。目前瀏覽器不需要 ePortal cookie；官方登入狀態由 Server 的 .eportal-profile/ 提供。`;
  officialLink.href = found.officialPath;
}

async function loadOverview() {
  refreshButton.disabled = true;
  setStatus("checking", "正在載入", "正在使用 server-side Playwright session。");

  try {
    const { response, data } = await api(
      `/api/modules/${encodeURIComponent(moduleId)}/overview`,
    );

    if (!response.ok) {
      const needsLogin =
        data.code === "EPORTAL_LOGIN_REQUIRED" || data.needsLogin === true;
      setStatus(
        "invalid",
        needsLogin ? "Server ePortal 需要重新登入" : "模組載入失敗",
        needsLogin ? "在 Server 主機執行 npm run login。" : data.error || "未知錯誤",
      );
      renderError(data.error || "Module request failed.", needsLogin);
      return;
    }

    setStatus(
      "valid",
      "Server 模組已連線",
      "這個頁面使用 server-side session，因此 Incognito 不需要 ePortal cookie。",
    );
    renderOverview(data);
  } catch (error) {
    setStatus("invalid", "模組載入失敗", error.message);
    renderError(error.message);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadOverview);

(async () => {
  try {
    await loadModuleInfo();
    await loadOverview();
  } catch (error) {
    setStatus("invalid", "模組載入失敗", error.message);
    renderError(error.message);
  }
})();
