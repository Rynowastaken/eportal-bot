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

      const headerScore = (headers) => {
        const joined = headers.join("|");
        const patterns = [
          /日期|時間/,
          /科目|課程/,
          /節次|節/,
          /缺曠|假別|類別|狀態/,
          /教師|授課/,
          /星期/,
        ];
        return patterns.reduce(
          (score, pattern) => score + (pattern.test(joined) ? 3 : 0),
          0,
        );
      };

      const tableCandidates = [...document.querySelectorAll("table")]
        .map((table) => {
          const rows = [...table.querySelectorAll("tr")];
          const headerRow =
            rows.find((row) => row.querySelectorAll("th").length >= 2) ||
            rows.find((row) => row.querySelectorAll("th,td").length >= 2);

          const headers = headerRow
            ? [...headerRow.querySelectorAll("th,td")].map((cell) =>
                clean(cell.textContent),
              )
            : [];

          const recognizedScore = headerScore(headers);

          return {
            table,
            rows,
            headers,
            headerRow,
            score:
              recognizedScore > 0
                ? recognizedScore + Math.min(rows.length, 12) * 0.1
                : 0,
          };
        })
        .filter((candidate) => candidate.rows.length > 0)
        .sort((a, b) => b.score - a.score);

      const candidate = tableCandidates[0] || null;

      if (!candidate || candidate.score < 1) {
        return {
          items: [],
          headers: [],
          termLabel: "",
          emptyMessage: /無資料|查無|沒有資料/.test(
            document.body?.innerText || "",
          )
            ? "目前沒有缺曠紀錄。"
            : "AIS 缺曠資料格式無法辨識。",
        };
      }

      const headers = candidate.headers;
      const headerIndex = (pattern) =>
        headers.findIndex((header) => pattern.test(header));

      const dateIndex = headerIndex(/日期|時間/);
      const courseIndex = headerIndex(/科目|課程/);
      const periodIndex = headerIndex(/節次|節/);
      const typeIndex = headerIndex(/缺曠|假別|類別|狀態/);
      const teacherIndex = headerIndex(/教師|授課/);
      const weekdayIndex = headerIndex(/星期/);
      const noteIndex = headerIndex(/備註|說明/);

      let lastDate = "";
      const items = [];

      for (const row of candidate.rows) {
        if (row === candidate.headerRow) continue;

        const cells = [...row.querySelectorAll("td")].map((cell) =>
          clean(cell.textContent),
        );
        if (cells.length < 2) continue;

        const joined = cells.join(" ");
        if (!joined || /查詢|搜尋|重設/.test(joined) && cells.length <= 2) {
          continue;
        }

        const read = (index) => (index >= 0 ? cells[index] || "" : "");

        let date = read(dateIndex);
        if (date) lastDate = date;
        else if (dateIndex >= 0) date = lastDate;

        const item = {
          date,
          weekday: read(weekdayIndex),
          course: read(courseIndex),
          period: read(periodIndex),
          type: read(typeIndex),
          teacher: read(teacherIndex),
          note: read(noteIndex),
          cells,
        };

        const meaningful =
          item.date ||
          item.course ||
          item.period ||
          item.type ||
          item.teacher ||
          item.note;

        if (!meaningful) continue;

        items.push(item);
      }

      const selectedLabels = [...document.querySelectorAll("select option:checked")]
        .map((option) => clean(option.textContent))
        .filter(Boolean)
        .filter((label) => /學年|學期|上學期|下學期|第.*學期/.test(label))
        .slice(0, 2);

      return {
        items,
        headers,
        termLabel: selectedLabels.join(" "),
        emptyMessage: items.length ? "" : "目前沒有缺曠紀錄。",
      };
    });

    return {
      source: "NUTC AIS",
      sourceUrl: AIS_ABSENCE_URL,
      timezone: "Asia/Taipei",
      fetchedAt: new Date().toISOString(),
      termLabel: parsed.termLabel || "",
      headers: parsed.headers || [],
      items: parsed.items || [],
      total: parsed.items?.length || 0,
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
