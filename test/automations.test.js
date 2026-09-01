const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAutomationInput,
  calculateNextRun,
  zonedDateTimeToUtc,
  formatAutomationSchedule,
  buildDefaultMorningBriefAutomation
} = require("../core/automations");

test("normalizes a one-time reminder", () => {
  const automation = normalizeAutomationInput({
    type: "reminder",
    name: "Take medication",
    message: "Take your morning medication.",
    scheduleType: "once",
    occurrences: [{ date: "2026-09-10", time: "9:05" }],
    timezone: "America/New_York"
  });

  assert.deepEqual(automation.occurrences, [{ date: "2026-09-10", time: "09:05" }]);
  assert.equal(automation.channel, "telegram");
  assert.equal(automation.enabled, true);
});

test("rejects incomplete recurring schedules", () => {
  assert.throws(() => normalizeAutomationInput({
    type: "morning_brief",
    name: "Morning brief",
    scheduleType: "recurring",
    daysOfWeek: ["monday"],
    timesOfDay: []
  }), /at least one day and time/);
});

test("converts an Eastern wall-clock time to UTC during daylight saving time", () => {
  assert.equal(
    zonedDateTimeToUtc("2026-09-10", "09:00", "America/New_York").toISOString(),
    "2026-09-10T13:00:00.000Z"
  );
});

test("calculates the next weekday occurrence across a weekend", () => {
  const next = calculateNextRun({
    scheduleType: "recurring",
    daysOfWeek: ["monday", "wednesday", "friday"],
    timesOfDay: ["09:00"],
    timezone: "America/New_York",
    startDate: null,
    endDate: null
  }, new Date("2026-09-11T14:00:00.000Z"));

  assert.equal(next, "2026-09-14T13:00:00.000Z");
});

test("multiple schedules advance to the next remaining occurrence", () => {
  const next = calculateNextRun({
    scheduleType: "multiple",
    occurrences: [
      { date: "2026-09-10", time: "09:00" },
      { date: "2026-09-12", time: "17:30" }
    ],
    timezone: "America/New_York"
  }, new Date("2026-09-10T14:00:00.000Z"));

  assert.equal(next, "2026-09-12T21:30:00.000Z");
});

test("formats recurring schedules for confirmations", () => {
  assert.equal(formatAutomationSchedule({
    scheduleType: "recurring",
    daysOfWeek: ["monday", "friday"],
    timesOfDay: ["09:00", "17:30"]
  }), "Mon, Fri at 9:00 AM, 5:30 PM");
});

test("onboarding's default morning brief runs every day at 9 AM", () => {
  const automation = normalizeAutomationInput(buildDefaultMorningBriefAutomation());
  assert.equal(automation.type, "morning_brief");
  assert.deepEqual(automation.timesOfDay, ["09:00"]);
  assert.deepEqual(new Set(automation.daysOfWeek), new Set([
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
  ]));
  assert.match(automation.instructions, /logged sleep, symptoms, recent patterns/);
});
