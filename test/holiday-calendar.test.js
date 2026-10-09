import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getWeekCalendar,
  parseNationalCalendarYear,
  resolveCalendarDay,
  taipeiWeekDateKeys,
} from "../src/holiday-calendar.js";

const nutc = JSON.parse(
  await readFile(new URL("../src/nutc-calendar-overrides.json", import.meta.url), "utf8"),
);

test("Taipei Monday-to-Sunday dates handle UTC offset and year rollover", () => {
  assert.deepEqual(taipeiWeekDateKeys(new Date("2026-12-31T18:30:00Z")), [
    "2026-12-28",
    "2026-12-29",
    "2026-12-30",
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
    "2027-01-03",
  ]);
});

test("national calendar parses full-year JSON and rejects incomplete data", () => {
  const fullYear = Array.from({ length: 365 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    return {
      date: date.toISOString().slice(0, 10).replaceAll("-", ""),
      isHoliday: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      description: "",
    };
  });
  fullYear[0].description = "開國紀念日";
  const parsed = parseNationalCalendarYear(fullYear, 2026);
  assert.equal(parsed.size, 365);
  assert.equal(parsed.get("2026-01-01").description, "開國紀念日");
  assert.throws(() => parseNationalCalendarYear(fullYear.slice(0, 10), 2026));
});

test("named government holiday cancels classes but an ordinary weekend does not", () => {
  const holiday = resolveCalendarDay(
    "2026-10-09", { isHoliday: true, description: "國慶日補假" }, nutc,
  );
  assert.equal(holiday.noClass, true);
  assert.equal(holiday.kind, "holiday");

  const weekend = resolveCalendarDay(
    "2026-10-04", { isHoliday: true, description: "" }, nutc,
  );
  assert.equal(weekend.noClass, false);
  assert.equal(weekend.kind, "normal");
});

test("NUTC school closure and winter break override government normal days", () => {
  const anniversary = resolveCalendarDay(
    "2027-04-02", { isHoliday: false, description: "" }, nutc,
  );
  assert.equal(anniversary.noClass, true);
  assert.equal(anniversary.label, "校慶補假");
  assert.equal(anniversary.source, "NUTC");

  const winter = resolveCalendarDay("2027-02-15", undefined, nutc);
  assert.equal(winter.noClass, true);
  assert.equal(winter.label, "寒假");
});

test("NUTC exceptions vary by academic program and override government holidays", () => {
  const saturdayClass = resolveCalendarDay(
    "2026-10-24", { isHoliday: true, description: "例假日" }, nutc, "weekend",
  );
  assert.equal(saturdayClass.noClass, false);
  assert.equal(saturdayClass.label, "假日班照常上課");

  const eveningCancelled = resolveCalendarDay("2027-04-24", undefined, nutc, "evening");
  const dayNotCancelled = resolveCalendarDay("2027-04-24", undefined, nutc, "day");
  assert.equal(eveningCancelled.noClass, true);
  assert.equal(dayNotCancelled.noClass, false);
});

test("missing national feed falls back to school exceptions without false public closures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("simulated offline");
  };

  try {
    const week = await getWeekCalendar(new Date("2027-03-31T12:00:00Z"));
    assert.equal(week.nationalStatus, "unavailable");
    const april2 = week.days.find((day) => day.date === "2027-04-02");
    assert.equal(april2.noClass, true);
    assert.equal(april2.source, "NUTC");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
