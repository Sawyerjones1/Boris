const assert = require("node:assert/strict");
const { test } = require("node:test");

const { normalizeRecurringScheduleInput } = require("../core/schedules");

test("recurring schedules normalize selected days and valid same-day times", () => {
  assert.deepEqual(
    normalizeRecurringScheduleInput({
      title: "  School  ",
      daysOfWeek: ["Monday", "monday", "THURSDAY", "not-a-day"],
      startTime: "09:30",
      endTime: "19:00",
      active: true
    }),
    {
      title: "School",
      category: null,
      daysOfWeek: ["monday", "thursday"],
      startTime: "09:30",
      endTime: "19:00",
      location: null,
      drainLevel: null,
      flexibility: null,
      active: true,
      notes: null
    }
  );
});

test("recurring schedules accept flexible time blocks", () => {
  const normalized = normalizeRecurringScheduleInput({
    title: "Weekly planning",
    daysOfWeek: ["sunday"],
    startTime: null,
    endTime: null
  });

  assert.equal(normalized.startTime, null);
  assert.equal(normalized.endTime, null);
});

test("recurring schedules reject incomplete and reversed time ranges", () => {
  assert.throws(
    () => normalizeRecurringScheduleInput({
      title: "School",
      daysOfWeek: ["monday"],
      startTime: "09:30",
      endTime: null
    }),
    /both a start and end time/i
  );

  assert.throws(
    () => normalizeRecurringScheduleInput({
      title: "School",
      daysOfWeek: ["monday"],
      startTime: "21:30",
      endTime: "19:00"
    }),
    /later than start time/i
  );
});
