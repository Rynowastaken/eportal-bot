const statusDot = document.querySelector("#aisStatusDot");
const statusTitle = document.querySelector("#aisStatusTitle");
const statusDetail = document.querySelector("#aisStatusDetail");
const refreshButton = document.querySelector("#refreshButton");
const content = document.querySelector("#content");

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
  const title = el(
    "h3",
    "ais-section-title",
    table.caption || `資料表 ${index + 1}`,
  );
  card.append(title);

  const wrap = el("div", "table-scroll");
  const tableEl = document.createElement("table");
  tableEl.className = "ais-table";

  for (const row of table.rows) {
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
    el("strong", "", data.title || "AIS 學生管理系統"),
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
  } else if (data.text?.length) {
    const card = el("article", "glass ais-text-card");
    card.append(el("h3", "ais-section-title", "AIS 可見內容"));
    const list = el("div", "ais-text-list");
    for (const line of data.text.slice(0, 40)) {
      list.append(el("p", "", line));
    }
    card.append(list);
    content.append(card);
  } else {
    const empty = el("article", "info-card glass");
    const copy = el("div");
    copy.append(
      el("strong", "", "AIS 已登入，但沒有找到可顯示的表格"),
      el(
        "p",
        "",
        "這表示我們需要針對實際 AIS 頁面增加課表/學籍的專用 selector。",
      ),
    );
    empty.append(copy);
    content.append(empty);
  }
}

function renderError(error, needsLogin) {
  content.replaceChildren();
  const card = el("article", "info-card glass");
  const copy = el("div");
  copy.append(
    el(
      "strong",
      "",
      needsLogin ? "Server ePortal session 需要重新登入" : "AIS 載入失敗",
    ),
    el(
      "p",
      "",
      needsLogin
        ? "請在 Server 主機執行 npm run login，完成一次人工登入後再重新整理。"
        : error,
    ),
  );
  card.append(copy);
  content.append(card);
}

async function load() {
  refreshButton.disabled = true;
  setStatus("checking", "正在載入 AIS", "正在使用 server-side Playwright session。");

  try {
    const response = await fetch("/api/ais/overview", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const needsLogin = data.code === "EPORTAL_LOGIN_REQUIRED" || data.needsLogin;
      setStatus(
        "invalid",
        needsLogin ? "Server ePortal 需要重新登入" : "AIS 載入失敗",
        needsLogin ? "在 Server 主機執行 npm run login。" : data.error || "未知錯誤",
      );
      renderError(data.error || "AIS request failed.", needsLogin);
      return;
    }

    setStatus(
      "valid",
      "Server AIS 已連線",
      "這個頁面使用 server-side session，因此 Incognito 不需要 ePortal cookie。",
    );
    renderOverview(data);
  } catch (error) {
    setStatus("invalid", "AIS 載入失敗", error.message);
    renderError(error.message, false);
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", load);
void load();
