const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tutorialPages = [
  "index.html", "chat.html", "records.html", "schedules.html", "automations.html", "trends.html", "notes.html"
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readTourConfig(fileName) {
  const html = read(path.join("ui", fileName));
  const match = html.match(/<script id="boris-page-tour" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, `${fileName} should include a page tour configuration`);
  return JSON.parse(match[1]);
}

test("each main product page has a short self-contained tutorial", () => {
  for (const fileName of tutorialPages) {
    const steps = readTourConfig(fileName);
    assert.ok(steps.length >= 3 && steps.length <= 5, `${fileName} should have 3-5 steps`);
    for (const step of steps) {
      assert.ok(step.selector || step.selectors?.length, "each step needs a target");
      assert.ok(step.title && step.body, "each step needs concise copy");
    }
  }
  assert.doesNotMatch(read("ui/dev-logs.html"), /id="boris-page-tour"/);
});

test("tour progress is stored idempotently and excludes development logs", () => {
  const neon = read("core/neon.js");
  const server = read("server.js");
  assert.match(neon, /CREATE TABLE IF NOT EXISTS visited_pages/);
  assert.match(neon, /PRIMARY KEY \(user_id, page_key\)/);
  assert.match(neon, /ON CONFLICT \(user_id, page_key\) DO NOTHING/);
  assert.match(neon, /"dashboard", "chat", "records", "schedules", "automations", "trends", "notes"/);
  assert.match(server, /app\.get\("\/api\/tour\/visited"/);
  assert.match(server, /app\.post\("\/api\/tour\/visited"/);
  assert.doesNotMatch(neon, /page_key IN \([^)]*dev-logs/);
});

test("the shared tour supports navigation dots and accessible dismissal", () => {
  const app = read("ui/assets/app.js");
  const styles = read("ui/assets/style.css");
  assert.match(app, /className = "tour-unread-dot"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /window\.addEventListener\("resize", scheduleTourPosition\)/);
  assert.match(app, /Step \$\{index \+ 1\} of \$\{tourState\.steps\.length\}/);
  assert.match(styles, /\.tour-spotlight/);
  assert.match(styles, /box-shadow: 0 0 0 9999px/);
});
