const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { setImmediate: nextTurn } = require("node:timers/promises");
const { test } = require("node:test");

const firstDate = "2026-09-14";
const secondDate = "2026-09-15";
const log = (date, mood, extras = {}) => ({ date, vitals: { mood }, ...extras });

function createDashboard() {
  const requests = [];
  const timers = [];
  const listeners = {};
  const draft = { value: "", listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler; } };
  const card = { inert: false, setAttribute() {}, classList: { toggle() {} } };
  const status = { text: "", variant: "", classList: { contains: (value) => value === status.variant } };
  const context = vm.createContext({
    console, URL, URLSearchParams,
    window: { setTimeout: (handler) => timers.push(handler), clearTimeout() {} },
    document: {
      body: { dataset: { page: "test" } },
      getElementById: (id) => id === "save-status" ? status : id === "what-changed" ? draft : null,
      querySelectorAll: (selector) => selector.startsWith("[data-card]") ? [card] : [],
      addEventListener: (type, handler) => { listeners[type] = handler; }
    },
    fetch: (url, options) => new Promise((resolve, reject) => {
      requests.push({
        url, body: options?.body ? JSON.parse(options.body) : null,
        resolve: (payload, ok = true) => resolve({ ok, status: ok ? 200 : 500, json: async () => payload }),
        reject
      });
    }),
    onRender: (state) => { draft.value = state.whatChanged; },
    onStatus: (text, variant) => { status.text = text; status.variant = variant; }
  });
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(__dirname, "../ui/assets/app.js"), "utf8"));
  run(`
    getTodayDateString = () => '2026-09-16';
    renderDashboard = () => onRender(appState.log);
    setStatus = onStatus;
    setCardLoading = () => {};
    showToast = () => {};
    syncDashboardTrackingLists = () => {};
    ensureWeatherRefreshLoop = () => {};
    loadActiveSupplements = async () => [];
    loadActivePrescriptions = async () => [];
    loadSymptomTrackingList = async () => [];
    globalThis.actualLoadWeather = loadWeatherData;
    loadWeatherData = async () => {};
    renderWeatherWidget = () => {};
    appState.dashboardDate = '${firstDate}';
    appState.log = normalizeLog({ date: '${firstDate}', vitals: { mood: 3 }, whatChanged: 'Original' });
    setupDashboardEvents();
  `);
  return {
    run, requests, status, card,
    save(patch) { context.patch = patch; return run("queueSave(patch)"); },
    load(date) { context.selectedDate = date; return run("loadDashboardData(selectedDate)"); },
    state() { return JSON.parse(run("JSON.stringify({ selectedDate: appState.dashboardDate, log: appState.log, pendingSaves: appState.pendingSaves })")); },
    typeDraft(value) {
      draft.value = value;
      const target = { value, closest: () => card };
      draft.listeners.input({ target });
      listeners.input({ target });
    },
    draft,
    flushTimers() { timers.splice(0).forEach((handler) => handler()); }
  };
}

test("a previous day's save cannot replace the selected log or retarget the next edit", async () => {
  const page = createDashboard();
  const oldSave = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  const load = page.load(secondDate);
  await nextTurn();
  page.requests[1].resolve(log(secondDate, 4));
  await load;
  page.requests[0].resolve(log(firstDate, 7));
  await oldSave;
  assert.equal(page.state().selectedDate, secondDate);
  assert.equal(page.state().log.date, secondDate);
  assert.equal(page.state().log.vitals.mood, 4);
  assert.equal(page.status.text, "Ready");
  const nextSave = page.save({ vitals: { mood: 8 } });
  await nextTurn();
  assert.equal(page.requests[2].body.date, secondDate);
  page.requests[2].resolve(log(secondDate, 8));
  await nextSave;
});

test("an earlier response cannot clobber a newer queued edit", async () => {
  const page = createDashboard();
  const first = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  const second = page.save({ vitals: { mood: 9 } });
  page.requests[0].resolve(log(firstDate, 7));
  await first;
  assert.equal(page.state().log.vitals.mood, 9);
  await nextTurn();
  assert.equal(page.requests[1].body.patch.vitals.mood, 9);
  page.requests[1].resolve(log(firstDate, 9, { lastUpdated: "2026-09-14T15:00:00Z" }));
  await second;
  assert.equal(page.state().log.vitals.mood, 9);
  assert.equal(page.state().log.lastUpdated, "2026-09-14T15:00:00Z");
  assert.equal(page.state().pendingSaves, 0);
});

test("typing an unsaved draft while saving preserves the draft and avoids a success claim", async () => {
  const page = createDashboard();
  const save = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  page.typeDraft("New draft still being typed");
  page.requests[0].resolve(log(firstDate, 7, { whatChanged: "Original" }));
  await save;
  page.flushTimers();
  assert.equal(page.state().log.whatChanged, "New draft still being typed");
  assert.equal(page.draft.value, "New draft still being typed", "response must not redraw the field; its input is owned by the user");
  assert.equal(page.status.text, "Unsaved changes");
});

test("queued payloads are snapshots rather than references to mutable form data", async () => {
  const page = createDashboard();
  const patch = { intake: { meals: [{ description: "Original meal" }] } };
  const save = page.save(patch);
  patch.intake.meals[0].description = "Changed after enqueue";
  await nextTurn();
  assert.equal(page.requests[0].body.patch.intake.meals[0].description, "Original meal");
  page.requests[0].resolve(log(firstDate, 3, { intake: { meals: [{ description: "Original meal" }] } }));
  await save;
});

for (const failOldLoad of [false, true]) {
  test(`out-of-order dashboard ${failOldLoad ? "errors" : "responses"} do not replace the newest day`, async () => {
    const page = createDashboard();
    const oldLoad = page.load(firstDate);
    await nextTurn();
    const newLoad = page.load(secondDate);
    await nextTurn();
    page.requests[1].resolve(log(secondDate, 8));
    await newLoad;
    if (failOldLoad) page.requests[0].reject(new Error("Old request failed"));
    else page.requests[0].resolve(log(firstDate, 2));
    await oldLoad;
    assert.equal(page.state().log.date, secondDate);
    assert.equal(page.state().log.vitals.mood, 8);
    assert.equal(page.status.text, "Ready");
    assert.equal(page.card.inert, false);
  });
}

test("returning to a day waits for its pending save before fetching its log", async () => {
  const page = createDashboard();
  const save = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  const otherDay = page.load(secondDate);
  await nextTurn();
  page.requests[1].resolve(log(secondDate, 4));
  await otherDay;
  const returning = page.load(firstDate);
  await nextTurn();
  assert.equal(page.requests.length, 2, "do not fetch a stale baseline before the save commits");
  page.requests[0].resolve(log(firstDate, 7));
  await save;
  await nextTurn();
  page.requests[2].resolve(log(firstDate, 7));
  await returning;
  assert.equal(page.state().log.date, firstDate);
  assert.equal(page.state().log.vitals.mood, 7);
});

test("an old save failure leaves the new day's status alone and the queue recovers", async () => {
  const page = createDashboard();
  const oldSave = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  const load = page.load(secondDate);
  await nextTurn();
  page.requests[1].resolve(log(secondDate, 4));
  await load;
  page.requests[0].reject(new Error("Save failed"));
  await oldSave;
  page.flushTimers();
  assert.equal(page.status.text, "Ready");
  const save = page.save({ vitals: { mood: 8 } });
  await nextTurn();
  page.requests[2].resolve(log(secondDate, 8));
  await save;
  page.flushTimers();
  assert.equal(page.status.text, "All changes saved");
  assert.equal(page.state().pendingSaves, 0);
});

test("old success timers and edits cannot interfere with a loading date", async () => {
  const page = createDashboard();
  const save = page.save({ vitals: { mood: 7 } });
  await nextTurn();
  page.requests[0].resolve(log(firstDate, 7));
  await save;
  const load = page.load(secondDate);
  await nextTurn();
  page.flushTimers();
  assert.equal(page.status.variant, "is-loading");
  assert.equal(page.card.inert, true);
  await page.save({ vitals: { mood: 1 } });
  assert.equal(page.requests.length, 2, "do not save old data under the newly selected date");
  page.requests[1].resolve(log(secondDate, 8));
  await load;
});

test("a failed log load does not enable editing an empty replacement", async () => {
  const page = createDashboard();
  const load = page.load(secondDate);
  await nextTurn();
  page.requests[0].reject(new Error("Database unavailable"));
  await load;
  await page.save({ supplements: [] });
  assert.equal(page.requests.length, 1);
  assert.equal(page.status.variant, "is-error");
  assert.equal(page.card.inert, true);
});

test("today's delayed weather response cannot alter another day's log", async () => {
  const page = createDashboard();
  page.run(`getTodayDateString = () => '${firstDate}'`);
  const weather = page.run("actualLoadWeather()");
  await nextTurn();
  const load = page.load(secondDate);
  await nextTurn();
  page.requests[1].resolve(log(secondDate, 4, { weather: { condition: "Saved weather" } }));
  await load;
  page.requests[0].resolve({ condition: "Today's weather" });
  await weather;
  assert.equal(page.state().log.weather, null, "a late response must not populate the newly selected day's weather");
});

test("a missing daily log can still be created after loading completes", async () => {
  const page = createDashboard();
  const load = page.load(secondDate);
  await nextTurn();
  page.requests[0].reject(new Error("No log found for this date"));
  await load;
  assert.equal(page.card.inert, false);
  assert.equal(page.state().log.date, secondDate);
  const save = page.save({ vitals: { mood: 6 } });
  await nextTurn();
  assert.equal(page.requests[1].body.date, secondDate);
  page.requests[1].resolve(log(secondDate, 6));
  await save;
  assert.equal(page.state().log.vitals.mood, 6);
});
