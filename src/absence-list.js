import { openAisWithServerSession } from "./portal-session.js";

const AIS_ABSENCE_URL =
  "https://ais.nutc.edu.tw/student/discipline/absence_list.aspx";
const CACHE_TTL_MS = 5 * 60_000;

let cachedAbsences = null;
let fetchInFlight = null;

function absenceError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function fetchFreshAbsences() {
  const session = await openAisWithServerSession({
    headless: true,
    timeoutMs: 8_000,
  });

  try {
    const { page } = session;

    await page.goto(AIS_ABSENCE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const current = new URL(page.url());

    if (
      current.hostname !== "ais.nutc.edu.tw" ||
      /\/login\.aspx$/i.test(current.pathname)
    ) {
      throw absenceError(
        "Server ePortal session expired. Sign in again to load absence records.",
        "EPORTAL_LOGIN_REQUIRED",
        401,
      );
    }

    await page
      .waitForFunction(
        () =>
          document.querySelectorAll("table").length > 0 ||
          /無資料|查無|沒有資料/.test(document.body?.innerText || ""),
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});

    const parsed = await page.evaluate(() => {
      const clean = (value) =>
        String(value ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const tables = [...document.querySelectorAll("table")];

      const candidate = tables
        .map((table) => {
          const rows = [...table.querySelectorAll("tr")];
          const headerRow = rows.find((row) => {
            const headers = [...row.querySelectorAll("th,td")].map((cell) =>
              clean(cell.textContent),
            );
            const joined = headers.join("|");

            return (
              /課程/.test(joined) &&
              /缺曠狀態|缺曠請假|缺曠/.test(joined) &&
              /上課教師|教師/.test(joined)
            );
          });

          if (!headerRow) return null;

          const headers = [...headerRow.querySelectorAll("th,td")].map((cell) =>
            clean(cell.textContent),
          );

          return { table, rows, headerRow, headers };
        })
        .find(Boolean);

      if (!candidate) {
        const bodyText = clean(document.body?.innerText || "");
        return {
          items: [],
          headers: [],
          termLabel: "",
          emptyMessage: /目前沒有資料|無資料|查無/.test(bodyText)
            ? "目前沒有缺曠紀錄。"
            : "AIS 缺曠資料格式無法辨識。",
        };
      }

      const { rows, headerRow, headers } = candidate;
      const headerIndex = (pattern) =>
        headers.findIndex((header) => pattern.test(header));

      const classIndex = headerIndex(/開課班級|班級/);
      const courseIndex = headerIndex(/課程/);
      const groupIndex = headerIndex(/分組/);
      const requiredIndex = headerIndex(/修別/);
      const creditIndex = headerIndex(/學分.*時數|學分\/時數/);
      const teacherIndex = headerIndex(/上課教師|教師/);
      const statusIndex = headerIndex(/缺曠狀態|缺曠請假|缺曠/);

      const items = [];

      for (const row of rows) {
        if (row === headerRow) continue;

        const cellElements = [...row.querySelectorAll("td")];
        const cells = cellElements.map((cell) => clean(cell.textContent));
        if (!cells.length) continue;

        const read = (index) => (index >= 0 ? cells[index] || "" : "");
        const statusCell = statusIndex >= 0 ? cellElements[statusIndex] : null;
        const statusLines = String(
          statusCell?.innerText || statusCell?.textContent || "",
        )
          .split(/\r?\n|、|，|;/)
          .map(clean)
          .filter(Boolean)
          .filter((entry) => !/^[-—–]+$/.test(entry));
        const status = statusLines.join(" · ");

        if (!status) continue;

        items.push({
          className: read(classIndex),
          course: read(courseIndex),
          group: read(groupIndex),
          required: read(requiredIndex),
          credits: read(creditIndex),
          teacher: read(teacherIndex),
          status,
          statusLines,
        });
      }

      const selectedLabels = [...document.querySelectorAll("select option:checked")]
        .map((option) => clean(option.textContent))
        .filter(Boolean)
        .filter((label) => /學期|上學期|下學期|第.*學期|\d{2,3}年/.test(label))
        .slice(0, 2);

      const summary = {};
      const bodyText = clean(document.body?.innerText || "");
      const summaryLabels = [
        "曠課",
        "遲到",
        "早退",
        "公假",
        "事假",
        "病假",
        "喪假",
        "生理假",
        "婚假",
        "分娩假",
        "產前假",
      ];

      for (const label of summaryLabels) {
        const pattern = new RegExp(
          label + "\\s*[：:]?\\s*(\\d+)",
        );
        const match = bodyText.match(pattern);
        if (match) summary[label] = Number(match[1]);
      }

      return {
        items,
        headers,
        termLabel: selectedLabels.join(" "),
        summary,
        emptyMessage: items.length ? "" : "目前沒有缺曠紀錄。",
      };
    });;

    return {
      source: "NUTC AIS",
      sourceUrl: AIS_ABSENCE_URL,
      timezone: "Asia/Taipei",
      fetchedAt: new Date().toISOString(),
      termLabel: parsed.termLabel || "",
      headers: parsed.headers || [],
      items: parsed.items || [],
      total: parsed.items?.length || 0,
      summary: parsed.summary || {},
      emptyMessage: parsed.emptyMessage || "",
    };
  } catch (error) {
    if (error?.code === "EPORTAL_LOGIN_REQUIRED") throw error;

    if (error?.name === "TimeoutError") {
      throw absenceError(
        "AIS absence records did not finish loading in time.",
        "ABSENCE_LIST_TIMEOUT",
        504,
      );
    }

    throw error;
  } finally {
    await session.context.close().catch(() => {});
  }
}

export function clearAbsenceListCache() {
  cachedAbsences = null;
}

export async function getAbsenceList({ force = false } = {}) {
  const now = Date.now();

  if (
    !force &&
    cachedAbsences &&
    now - cachedAbsences.cachedAtMs < CACHE_TTL_MS
  ) {
    return {
      ...cachedAbsences.value,
      cached: true,
      stale: false,
    };
  }

  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const value = await fetchFreshAbsences();
      cachedAbsences = {
        cachedAtMs: Date.now(),
        value,
      };

      return {
        ...value,
        cached: false,
        stale: false,
      };
    } catch (error) {
      if (error?.code === "EPORTAL_LOGIN_REQUIRED") {
        clearAbsenceListCache();
        throw error;
      }

      if (cachedAbsences) {
        return {
          ...cachedAbsences.value,
          cached: true,
          stale: true,
          refreshError: error?.message || "Unable to refresh absence records.",
        };
      }

      throw error;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}
