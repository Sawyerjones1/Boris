const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { averageEnergy, buildTrends, summarizeDurations } = require("../core/trends");

test("averageEnergy uses every available daily energy rating", () => {
  assert.equal(averageEnergy({ morning: 4, evening: 8 }), 6);
  assert.equal(averageEnergy({ morning: "7" }), 7);
  assert.equal(averageEnergy({ evening: 3 }), 3);
  assert.equal(averageEnergy({ morning: "", evening: null }), null);
});

test("duration summaries include averages, medians, and sample counts", () => {
  assert.deepEqual(summarizeDurations([0, 20, 40, 50]), {
    avgDuration: 27.5,
    medianDuration: 30,
    count: 4
  });
  assert.deepEqual(summarizeDurations([]), {
    avgDuration: null,
    medianDuration: null,
    count: 0
  });
});

test("exertion comparison sums the previous calendar day and counts rest days as zero", () => {
  const result = buildTrends([
    { date: "2026-09-06", exercise: [{ duration: 10 }, { duration: 20 }], flareDay: false, vitals: {} },
    { date: "2026-09-07", exercise: [{ duration: 20 }, { duration: 5 }], flareDay: true, vitals: {} },
    { date: "2026-09-08", exercise: [], flareDay: true, vitals: {} },
    { date: "2026-09-09", exercise: [{ duration: 30 }], flareDay: false, vitals: {} },
    { date: "2026-09-10", exercise: [], flareDay: false, vitals: {} }
  ], { startDate: "2026-09-07", endDate: "2026-09-10" });

  assert.equal(result.range.loggedDays, 4, "the prefetched prior day is not part of the selected range");
  assert.deepEqual(result.exertionBeforeFlare, {
    beforeFlareDays: { avgDuration: 27.5, medianDuration: 27.5, count: 2 },
    beforeNonFlareDays: { avgDuration: 15, medianDuration: 15, count: 2 }
  });
});

test("trends use ISO week buckets and tolerate sparse daily fields", () => {
  const result = buildTrends([
    {
      date: "2026-09-06",
      vitals: { sleep: { hours: 7.5 }, energy: { morning: 4, evening: 6 }, mood: 7 },
      symptoms: [{ name: "Headache", present: true }],
      flareDay: true
    },
    {
      date: "2026-09-07",
      vitals: { stress: 3 },
      symptoms: [{ name: "Headache", present: false }, { name: "Nausea", present: true }],
      flareDay: false
    }
  ], { startDate: "2026-09-06", endDate: "2026-09-08" });

  assert.deepEqual(result.weeklyFlare.map((week) => [week.weekKey, week.count]), [
    ["2026-W36", 1],
    ["2026-W37", 0]
  ]);
  assert.deepEqual(result.sleep, [
    { date: "2026-09-06", hours: 7.5, flareDay: true },
    { date: "2026-09-07", hours: null, flareDay: false }
  ]);
  assert.deepEqual(result.scores, [
    { date: "2026-09-06", mood: 7, energy: 5, stress: null },
    { date: "2026-09-07", mood: null, energy: null, stress: 3 }
  ]);
});

test("symptom frequency is generic, case-insensitive, and folds results after the top five", () => {
  const result = buildTrends([
    {
      date: "2026-09-07",
      vitals: {},
      symptoms: [
        { name: "Alpha", present: true },
        { name: "alpha", present: true },
        { name: "Beta", present: true },
        { name: "Gamma", present: true },
        { name: "Delta", present: true },
        { name: "Epsilon", present: true },
        { name: "Zeta", present: true },
        { name: "Ignored", present: false }
      ]
    },
    {
      date: "2026-09-14",
      vitals: {},
      symptoms: [
        { name: "Alpha", present: true },
        { name: "Beta", present: true },
        { name: "Gamma", present: true }
      ]
    }
  ], { startDate: "2026-09-07", endDate: "2026-09-20" });

  const { series } = result.symptomFrequency;
  assert.deepEqual(series.map((item) => item.name), ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Other"]);
  assert.deepEqual(series.map((item) => item.total), [2, 2, 2, 1, 1, 1]);
  assert.deepEqual(series[0].values.map((item) => item.count), [1, 1]);
  assert.deepEqual(series.at(-1).values.map((item) => item.count), [1, 0]);
});

test("an empty all-time result stays compact", () => {
  const result = buildTrends([], {
    startDate: "1900-01-01",
    endDate: "2026-09-10",
    allTime: true
  });

  assert.equal(result.range.startDate, "2026-09-10");
  assert.equal(result.range.loggedDays, 0);
  assert.equal(result.weeklyFlare.length, 1);
  assert.deepEqual(result.symptomFrequency.series, []);
});

test("Trends is linked in the requested sidebar order and exposes five chart mounts", () => {
  const uiDirectory = path.join(__dirname, "..", "ui");
  const pages = ["index.html", "chat.html", "records.html", "schedules.html", "automations.html", "notes.html", "dev-logs.html"];

  for (const page of pages) {
    const html = fs.readFileSync(path.join(uiDirectory, page), "utf8");
    const automations = html.indexOf('href="/automations"');
    const trends = html.indexOf('href="/trends"');
    const notes = html.indexOf('href="/notes"');
    assert.ok(automations >= 0 && trends > automations && notes > trends, `${page} should link Automations, Trends, then Doctor's Notes`);
  }

  const trendsPage = fs.readFileSync(path.join(uiDirectory, "trends.html"), "utf8");
  for (const id of ["trend-sleep", "trend-flare", "trend-exertion", "trend-scores", "trend-symptoms"]) {
    assert.match(trendsPage, new RegExp(`id="${id}"`));
  }
  assert.ok(
    trendsPage.indexOf('id="trend-flare"') < trendsPage.indexOf('id="trend-exertion"'),
    "the exertion comparison should be placed directly after weekly flare days"
  );
});
