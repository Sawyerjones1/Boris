const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

test("demo symptoms remain available after the last seeded day without logging occurrences", async () => {
  const logs = new Map();
  const lists = new Map();
  const seedProcess = { env: { DEMO_END_DATE: "2026-09-10" }, argv: [] };
  const noop = async () => {};
  const seedFilename = path.join(__dirname, "../scripts/seed-demo-data.js");
  const modules = {
    fs: { readFileSync: () => JSON.stringify({ userId: "portfolio-demo" }) },
    path,
    "../core/neon": {
      pool: { query: noop, end: noop }, initSchema: noop,
      replaceDailyLog: async (_userId, date, log) => logs.set(date, JSON.parse(JSON.stringify(log))),
      saveUserList: async (userId, key, items) => {
        assert.equal(userId, "portfolio-demo");
        lists.set(key, Array.from(items));
      },
      saveMemoryFile: noop, saveSummary: noop, saveSupplement: noop,
      savePrescription: noop, logApiCall: noop
    },
    "../core/schedules": { createRecurringSchedule: noop, upsertPlanningPreferences: noop },
    "../core/automations": { ensureDefaultMorningBrief: noop },
    "../core/chat": { appendToThread: noop }
  };
  // Execute the real seed; storage and external services are isolated from local data.
  await vm.runInNewContext(fs.readFileSync(seedFilename, "utf8"), {
    __dirname: path.dirname(seedFilename), process: seedProcess,
    console: { log() {}, error: (...args) => assert.fail(args.join(" ")) },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected seed dependency: ${name}`);
      return modules[name];
    }
  }, { filename: seedFilename });
  assert.equal(seedProcess.exitCode, undefined);
  assert.equal(logs.size, 120);
  const expected = ["Fatigue", "Bloating", "Anxiety", "Headache", "Brain fog"];
  assert.deepEqual(lists.get("symptoms"), expected);

  const savedHistory = JSON.stringify([...logs]);
  // Match the reported case: both a missing day and a saved day with no symptoms.
  logs.set("2026-09-15", { date: "2026-09-15", symptoms: [] });
  const context = vm.createContext({
    console, URL, URLSearchParams, window: {},
    document: {
      body: { dataset: { page: "test" } },
      getElementById: () => null, querySelectorAll: () => [], addEventListener() {}
    },
    fetch: async (url) => {
      let payload;
      if (url === "/tracking/symptoms") payload = { items: lists.get("symptoms") };
      else if (["/supplements/active", "/prescriptions/active"].includes(url)) payload = [];
      else {
        assert.ok(url.startsWith("/log/"), `Unexpected dashboard request: ${url}`);
        payload = logs.get(url.slice("/log/".length));
      }
      return {
        ok: payload !== undefined, status: payload === undefined ? 404 : 200,
        json: async () => payload === undefined ? { error: "No log found for this date" } : structuredClone(payload)
      };
    }
  });
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(__dirname, "../ui/assets/app.js"), "utf8"));
  run(`
    getTodayDateString = () => '2026-09-16';
    renderDashboard = () => {};
    setStatus = () => {};
    showToast = (message) => { throw new Error(message); };
    ensureWeatherRefreshLoop = () => {};
    loadWeatherData = async () => {};
  `);
  for (const date of ["2026-09-10", "2026-09-11", "2026-09-15", "2026-09-10"]) {
    await run(`loadDashboardData('${date}')`);
    const log = JSON.parse(run("JSON.stringify(appState.log)"));
    assert.equal(log.date, date);
    assert.deepEqual(log.symptoms.map(({ name }) => name), expected);
    if (date > "2026-09-10") {
      assert.ok(log.symptoms.every((item) => !item.present && !item.logged && item.time === null));
    }
  }
  logs.delete("2026-09-15");
  assert.equal(JSON.stringify([...logs]), savedHistory, "loading checklists must not rewrite history");
});
