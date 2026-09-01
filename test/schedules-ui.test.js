const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../ui/assets/app.js"), "utf8");
const html = readFileSync(join(__dirname, "../ui/schedules.html"), "utf8");

function createContext() {
  const context = vm.createContext({
    console,
    URLSearchParams,
    window: { setTimeout, clearTimeout },
    document: {
      body: { dataset: {}, classList: { toggle() {} } },
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; }
    }
  });
  vm.runInContext(source, context);
  return context;
}

test("schedule controls use focused dialogs and keep blocks below the weekly rhythm", () => {
  const weeklyIndex = html.indexOf('id="recurring-week-grid"');
  const listIndex = html.indexOf('id="recurring-list"');

  assert.ok(weeklyIndex >= 0 && listIndex > weeklyIndex);
  assert.match(html, /id="recurring-editor-modal"[^>]*hidden/);
  assert.match(html, /id="planning-preferences-modal"[^>]*hidden/);
  assert.doesNotMatch(html, /recurring-form-step/);
});

test("Google calendar labels and colors are generated from connected calendar names", () => {
  const context = createContext();
  const workLabel = vm.runInContext('getCalendarSourceLabel({ sourceType: "google", calendarName: "Team Schedule" })', context);
  const familyColor = vm.runInContext('getCalendarSourceColor("Family")', context);
  const familyColorAgain = vm.runInContext('getCalendarSourceColor("Family")', context);
  const workColor = vm.runInContext('getCalendarSourceColor("Work")', context);

  assert.equal(workLabel, "Team Schedule");
  assert.equal(familyColor, familyColorAgain);
  assert.match(familyColor, /^#[0-9a-f]{6}$/i);
  assert.notEqual(familyColor, workColor);
});
