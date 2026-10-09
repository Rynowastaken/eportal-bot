import { readFile } from "node:fs/promises";

const NATIONAL_CALENDAR_URL =
  "https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data";
const NUTC_CALENDAR_FILE = new URL("./nutc-calendar-overrides.json", import.meta.url);
const NATIONAL_CACHE_TTL_MS = 24 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 4_000;
const yearlyCache = new Map();
const pendingYears = new Map();

function taipeiDateKey(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function taipeiWeekDateKeys(now = new Date()) {
  const current = new Date(`${taipeiDateKey(now)}T12:00:00Z`);
  const day = current.getUTCDay();
  current.setUTCDate(current.getUTCDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(current);
    date.setUTCDate(current.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function parseNationalCalendarYear(entries, year) {
  if (!Array.isArray(entries) || entries.length < 300) {
    throw new Error(`Incomplete Taiwan government calendar for ${year}.`);
  }

  const dates = new Map();
  for (const entry of entries) {
    if (
      typeof entry?.date !== "string" ||
      !/^\d{8}$/.test(entry.date) ||
      !entry.date.startsWith(String(year)) ||
      typeof entry.isHoliday !== "boolean"
    ) {
      continue;
    }
    const date = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`;
    dates.set(date, {
      isHoliday: entry.isHoliday,
      description: String(entry.description || "").trim().slice(0, 100),
    });
  }
  if (dates.size < 300) throw new Error(`Incomplete Taiwan calendar days for ${year}.`);
  return dates;
}

async function nationalYear(year) {
  const cached = yearlyCache.get(year);
  if (cached && Date.now() - cached.fetchedAt < NATIONAL_CACHE_TTL_MS) {
    return { dates: cached.dates, status: "available" };
  }
  if (pendingYears.has(year)) return pendingYears.get(year);

  const request = (async () => {
    try {
      const response = await fetch(`${NATIONAL_CALENDAR_URL}/${year}.json`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Holiday calendar HTTP ${response.status}`);
      const dates = parseNationalCalendarYear(await response.json(), year);
      yearlyCache.set(year, { dates, fetchedAt: Date.now() });
      return { dates, status: "available" };
    } catch (error) {
      console.warn("[calendar] Taiwan holidays unavailable:", error?.message || error);
      return cached
        ? { dates: cached.dates, status: "stale" }
        : { dates: new Map(), status: "unavailable" };
    } finally {
      pendingYears.delete(year);
    }
  })();

  pendingYears.set(year, request);
  return request;
}

export function resolveCalendarDay(date, nationalDay, academicCalendar, program = "day") {
  const days = Array.isArray(academicCalendar?.days) ? academicCalendar.days : [];
  const ranges = Array.isArray(academicCalendar?.ranges) ? academicCalendar.ranges : [];
  const applicable = (event) =>
    Array.isArray(event?.programs) && event.programs.includes(program);

  const dated = days.find((event) => event.date === date && applicable(event));
  const range = ranges.find((event) =>
    applicable(event) && event.start <= date && date <= event.end,
  );

  // Ordinary government weekends are not necessarily no-class days at NUTC.
  const isPublicHoliday = Boolean(
    nationalDay?.isHoliday && nationalDay.description,
  );
  const isMakeupWorkday = Boolean(
    nationalDay && !nationalDay.isHoliday &&
      /補行上班|補班|調整上班/.test(nationalDay.description || ""),
  );

  // Specific NUTC date > named government holiday > semester break range.
  if (dated) {
    return {
      date,
      label: String(dated.label || "").slice(0, 80),
      noClass: dated.noClass === true,
      kind: "school",
      source: "NUTC",
    };
  }
  if (isPublicHoliday) {
    return {
      date,
      label: nationalDay.description,
      noClass: true,
      kind: "holiday",
      source: "DGPA",
    };
  }
  if (range) {
    return {
      date,
      label: String(range.label || "").slice(0, 80),
      noClass: range.noClass === true,
      kind: "school",
      source: "NUTC",
    };
  }
  if (isMakeupWorkday) {
    return {
      date,
      label: nationalDay.description,
      noClass: false,
      kind: "makeup",
      source: "DGPA",
    };
  }
  return { date, label: "", noClass: false, kind: "normal", source: null };
}

export async function getWeekCalendar(now = new Date()) {
  const dates = taipeiWeekDateKeys(now);
  const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
  const nationalResults = await Promise.all(years.map((year) => nationalYear(year)));
  const nationalByYear = new Map(years.map((year, index) => [year, nationalResults[index]]));

  let academicCalendar = {};
  try {
    academicCalendar = JSON.parse(await readFile(NUTC_CALENDAR_FILE, "utf8"));
  } catch (error) {
    console.warn("[calendar] NUTC overrides unavailable:", error?.message || error);
  }

  const configuredProgram = String(process.env.EPORTAL_ACADEMIC_PROGRAM || "day").toLowerCase();
  const program = ["day", "evening", "weekend"].includes(configuredProgram)
    ? configuredProgram
    : "day";
  const days = dates.map((date) => {
    const national = nationalByYear.get(Number(date.slice(0, 4)))?.dates.get(date);
    return resolveCalendarDay(date, national, academicCalendar, program);
  });
  const statuses = nationalResults.map((entry) => entry.status);

  return {
    days,
    program,
    nationalStatus: statuses.includes("unavailable")
      ? "unavailable"
      : statuses.includes("stale")
        ? "stale"
        : "available",
    nationalSource: "https://data.gov.tw/dataset/14718",
    academicSource: academicCalendar.sourceUrl || null,
  };
}
