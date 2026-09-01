const assert = require("node:assert/strict");
const Module = require("node:module");
const { test } = require("node:test");

function loadScheduler({ summaries = {}, logs = [] } = {}) {
  const scheduledJobs = [];
  const savedSummaries = [];
  const llmPayloads = [];
  const listSummaries = async (_userId, type) =>
    (summaries[type] || []).map((period) => ({ period, created_at: null }));
  const getSummary = async (_userId, type, period) =>
    (summaries[type] || []).includes(period) ? { content: `${type}:${period}` } : null;
  const mockedModules = {
    "node-cron": { schedule: (expression, handler, options) => scheduledJobs.push({ expression, handler, options }) },
    "./api": {
      getOpenAIClient: () => ({}),
      setApiContext() {},
      createTrackedResponse: async (request) => {
        llmPayloads.push(JSON.parse(request.input));
        const output = String(request.instructions || "").includes("regenerating health-picture.md")
          ? "# Current Supplement Stack\n- None\n\n# Active Patterns\n- Insufficient data\n\n# Lab Picture\n- No data\n\n# Current Concerns\n- None"
          : "Generated summary";
        return { response: { output_text: output } };
      }
    },
    "./time": {
      APP_TIMEZONE: "America/New_York",
      addDaysToDateString(date, delta) {
        const anchor = new Date(`${date}T12:00:00Z`);
        anchor.setUTCDate(anchor.getUTCDate() + delta);
        return anchor.toISOString().slice(0, 10);
      },
      formatDisplayDate: (date) => date,
      getAppDateString: () => "2026-10-01",
      getAppNow: () => ({ year: 2026, month: 10, day: 1, date: "2026-10-01" }),
      getTimestamp: () => "2026-10-01T00:00:00.000Z"
    },
    "./profile": {
      archiveHealthPicture: async () => {},
      readIdentity: async () => "# Identity\n- Name: Test User\n",
      readHealthPicture: async () => "# Current Supplement Stack\n",
      readOnboardingSnapshot: async () => "# Onboarding Snapshot\n",
      writeHealthPicture: async () => {}
    },
    "./db": { getActiveUser: async () => "test-user" },
    "./neon": {
      getLog: async () => null,
      getDateRange: async () => logs,
      saveSummary: async (_userId, type, period, content) => savedSummaries.push({ type, period, content }),
      getSummary,
      listSummaries,
      getRecentSummaries: async () => [],
      getThread: async () => null,
      archiveThread: async () => {},
      truncateOldLogs: async () => 0,
      getRecurringSchedules: async () => [],
      getActiveSupplements: async () => [],
      getActivePrescriptions: async () => [],
      getSupplements: async () => [],
      getPrescriptions: async () => [],
      getLabResults: async () => [],
      getDoctorVisits: async () => []
    },
    "./schedules": { getCalendarEvents: async () => [], getPlanningPreferences: async () => null },
    "./telegram": { sendTelegramMessage: async () => {} },
    "./utils": { numberOrNull: (value) => Number.isFinite(Number(value)) ? Number(value) : null }
  };
  const originalLoad = Module._load;
  const schedulerPath = require.resolve("../core/scheduler");
  delete require.cache[schedulerPath];
  Module._load = function mockLoad(request, parent, isMain) {
    if (parent?.filename === schedulerPath && mockedModules[request]) return mockedModules[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  let scheduler;
  try {
    scheduler = require("../core/scheduler");
  } finally {
    Module._load = originalLoad;
  }
  return { scheduler, scheduledJobs, savedSummaries, llmPayloads };
}

test("summary period helpers use completed calendar boundaries", () => {
  const { scheduler } = loadScheduler();
  assert.deepEqual(scheduler.getIsoWeekPeriod("2027-01-03"), {
    weekLabel: "2026-W53", weekStart: "2026-12-28", weekEnd: "2027-01-03"
  });
  assert.deepEqual(scheduler.getMonthPeriod("2026-02-28"), {
    monthKey: "2026-02", monthStart: "2026-02-01", monthEnd: "2026-02-28"
  });
  assert.deepEqual(scheduler.getQuarterPeriod("2026-09-30").months, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(scheduler.getLatestCompletedWeekEnd("2026-10-05"), "2026-10-04");
  assert.equal(scheduler.getLatestCompletedMonthEnd("2026-10-01"), "2026-09-30");
  assert.equal(scheduler.getLatestCompletedQuarterEnd("2026-10-01"), "2026-09-30");
  assert.equal(scheduler.getLatestCompletedYearEnd("2027-01-01"), "2026-12-31");
});

test("weekly summary only uses daily summaries and logs inside its Monday–Sunday range", async () => {
  const { scheduler, llmPayloads, savedSummaries } = loadScheduler({
    summaries: { daily: ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-28", "2026-10-04"] },
    logs: [{ date: "2026-09-28", vitals: {} }, { date: "2026-10-04", vitals: {} }]
  });
  await scheduler.generateWeeklySummary("test-user", { weekEnd: "2026-10-04" });
  assert.deepEqual(llmPayloads[0].dailySummaries.map((item) => item.date), ["2026-09-28", "2026-10-04"]);
  assert.deepEqual(llmPayloads[0].logs.map((item) => item.date), ["2026-09-28", "2026-10-04"]);
  assert.deepEqual(savedSummaries[0], { type: "weekly", period: "2026-W40", content: "Generated summary" });
});

test("monthly summaries exclude weeks that cross its boundary and unrelated months", async () => {
  const { scheduler, llmPayloads, savedSummaries } = loadScheduler({
    summaries: {
      weekly: ["2026-W36", "2026-W37", "2026-W40", "2026-W05"],
      daily: ["2026-08-31", "2026-09-02", "2026-09-30", "2026-10-01"]
    }
  });
  await scheduler.generateMonthlySummary("test-user", { monthEnd: "2026-09-30" });
  assert.deepEqual(llmPayloads[0].weeklySummaries.map((item) => item.label), ["2026-W37"]);
  assert.deepEqual(llmPayloads[0].dailyHighlights.map((item) => item.date), ["2026-09-02", "2026-09-30"]);
  assert.deepEqual(savedSummaries[0], { type: "monthly", period: "2026-09", content: "Generated summary" });
});

test("quarterly and yearly summaries use only summaries from their explicit periods", async () => {
  const quarter = loadScheduler({ summaries: { monthly: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"] } });
  await quarter.scheduler.generateQuarterlySummary("test-user", { quarterEnd: "2026-09-30" });
  assert.deepEqual(quarter.llmPayloads[0].monthlySummaries.map((item) => item.month), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(quarter.savedSummaries[0].period, "2026-Q3");

  const year = loadScheduler({ summaries: { quarterly: ["2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2027-Q1"] } });
  await year.scheduler.generateYearlySummary("test-user", { yearEnd: "2026-12-31" });
  assert.deepEqual(year.llmPayloads[0].quarterlySummaries.map((item) => item.quarter), ["2026-Q1", "2026-Q2", "2026-Q3"]);
  assert.equal(year.savedSummaries[0].period, "2026");
});

test("scheduled summaries run after their completed period closes", () => {
  const { scheduler, scheduledJobs } = loadScheduler();
  scheduler.initScheduler();
  assert.deepEqual(
    scheduledJobs.map((job) => job.expression),
    ["0 3 * * *", "30 3 * * 1", "0 4 1 * *", "30 4 1 1,4,7,10 *", "0 5 1 1 *", "0 4 * * 1"]
  );
});
