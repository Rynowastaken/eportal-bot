import { openAisWithServerSession } from "./portal-session.js";

const AIS_SCHEDULE_URL =
  "https://ais.nutc.edu.tw/student/courses/my_week_time.aspx";
const CACHE_TTL_MS = 5 * 60_000;

export const CLASS_SCHEDULE_TIME_SLOTS = Object.freeze([
  { slot: "1", time: "08:20~09:10" },
  { slot: "2", time: "09:20~10:10" },
  { slot: "3", time: "10:20~11:10" },
  { slot: "4", time: "11:20~12:10" },
  { slot: "5", time: "13:10~14:00" },
  { slot: "6", time: "14:10~15:00" },
  { slot: "7", time: "15:10~16:00" },
  { slot: "8", time: "16:10~17:00" },
  { slot: "9", time: "17:10~18:00" },
  { slot: "10", time: "18:20~19:10" },
  { slot: "11", time: "19:15~20:05" },
  { slot: "12", time: "20:10~21:00" },
  { slot: "13", time: "21:05~21:55" },
  { slot: "14", time: "22:00~22:50" },
]);

const DAY_LABELS = Object.freeze([
  "週一",
  "週二",
  "週三",
  "週四",
  "週五",
  "週六",
  "週日",
]);

let cachedSchedule = null;
let fetchInFlight = null;

function scheduleError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function fetchFreshSchedule() {
  const session = await openAisWithServerSession({
    headless: true,
    timeoutMs: 8_000,
  });

  try {
    const { page } = session;

    await page.goto(AIS_SCHEDULE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const current = new URL(page.url());

    if (
      current.hostname !== "ais.nutc.edu.tw" ||
      /\/login\.aspx$/i.test(current.pathname)
    ) {
      throw scheduleError(
        "Server ePortal session expired. Sign in again to load the class schedule.",
        "EPORTAL_LOGIN_REQUIRED",
        401,
      );
    }

    await page.waitForFunction(
      () =>
        typeof globalThis.g_ClsTime === "object" &&
        globalThis.g_ClsTime !== null,
      null,
      { timeout: 12_000 },
    );

    const parsed = await page.evaluate(() => {
      const source = globalThis.g_ClsTime || {};
      const clean = (value) => {
        const element = document.createElement("div");
        element.innerHTML = String(value ?? "");
        return String(element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      };

      const entries = [];

      for (const [key, rawValue] of Object.entries(source)) {
        const parts = String(key).split("-");
        const day = Number(parts[0]);
        const period = Number(parts[1]);

        if (
          !Number.isInteger(day) ||
          day < 1 ||
          day > 7 ||
          !Number.isInteger(period) ||
          period < 1 ||
          period > 14
        ) {
          continue;
        }

        const fields = String(rawValue ?? "").split("\t");
        const course = {
          name: clean(fields[1]),
          teacher: clean(fields[2]),
          room: clean(fields[3]),
        };

        if (!course.name && !course.teacher && !course.room) continue;

        entries.push({
          dayIndex: day - 1,
          periodIndex: period - 1,
          course,
        });
      }

      const selectedLabels = [...document.querySelectorAll("select option:checked")]
        .map((option) => String(option.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((label) => /學年|學期|上學期|下學期/.test(label))
        .slice(0, 2);

      return {
        entries,
        termLabel: selectedLabels.join(" "),
      };
    });

    const periods = CLASS_SCHEDULE_TIME_SLOTS.map(({ slot, time }) => ({
      slot,
      time,
      days: DAY_LABELS.map(() => ({})),
    }));

    for (const entry of parsed.entries) {
      const period = periods[entry.periodIndex];
      if (!period) continue;
      period.days[entry.dayIndex] = entry.course;
    }

    const fetchedAt = new Date().toISOString();
    const scheduledCells = parsed.entries.length;

    return {
      source: "NUTC AIS",
      sourceUrl: AIS_SCHEDULE_URL,
      timezone: "Asia/Taipei",
      fetchedAt,
      termLabel: parsed.termLabel || "",
      dayLabels: DAY_LABELS,
      periods,
      scheduledCells,
    };
  } catch (error) {
    if (error?.code === "EPORTAL_LOGIN_REQUIRED") throw error;

    if (error?.name === "TimeoutError") {
      throw scheduleError(
        "AIS class schedule did not finish loading in time.",
        "CLASS_SCHEDULE_TIMEOUT",
        504,
      );
    }

    throw error;
  } finally {
    await session.context.close().catch(() => {});
  }
}

export function clearClassScheduleCache() {
  cachedSchedule = null;
}

export async function getClassSchedule({ force = false } = {}) {
  const now = Date.now();

  if (
    !force &&
    cachedSchedule &&
    now - cachedSchedule.cachedAtMs < CACHE_TTL_MS
  ) {
    return {
      ...cachedSchedule.value,
      cached: true,
      stale: false,
    };
  }

  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const value = await fetchFreshSchedule();
      cachedSchedule = {
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
        clearClassScheduleCache();
        throw error;
      }

      if (cachedSchedule) {
        return {
          ...cachedSchedule.value,
          cached: true,
          stale: true,
          refreshError: error?.message || "Unable to refresh class schedule.",
        };
      }

      throw error;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}
