const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const before = "# Current Supplement Stack\n- Magnesium\n\n";
const oldSection = "# Lab Picture\n\n### Most Recent Overview (as of Sep 8, 2026)\nCRP 4.8 mg/L (high). Old panel details here.";
const after = "# Current Concerns\n- Fatigue";

// Load the real module with in-memory storage and a deterministic AI response.
// No credentials, provider calls, or changes to the user's database are needed.
function loadExtractor(initialPicture = before + oldSection + "\n\n" + after) {
  let picture = initialPicture;
  let records = [];
  let aiCalls = 0;
  const filename = require.resolve("../core/extractor");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const mocks = {
    "./api": {
      getOpenAIClient: () => ({}),
      setApiContext() {},
      async createTrackedResponse() {
        aiCalls += 1;
        return { response: { output_text: "Updated overview." } };
      }
    },
    "./profile": {
      readIdentity: async () => "# Identity\n- Name: Test User",
      readHealthPicture: async () => picture,
      writeHealthPicture: async (_userId, content) => { picture = content; }
    },
    "./neon": { getLabResults: async () => records }
  };
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (name) => mocks[name] || originalRequire(name);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return {
    ...loaded.exports,
    get picture() { return picture; },
    get aiCalls() { return aiCalls; },
    setRecords(value) { records = value; }
  };
}

test("extracts the entire Lab Picture through nested headings and blank lines", () => {
  const { extractLabPictureSection } = loadExtractor();
  assert.equal(extractLabPictureSection(before + oldSection + "\n\n" + after), oldSection);
  assert.equal(extractLabPictureSection(before + oldSection), oldSection);
  assert.equal(extractLabPictureSection(after), "");
});

test("replaces old lab data without changing neighboring sections", () => {
  const { replaceLabPictureSection } = loadExtractor();
  const out = replaceLabPictureSection(before + oldSection + "\n\n" + after, "No saved lab results.");
  assert.equal(out, before + "# Lab Picture\n\nNo saved lab results.\n\n" + after + "\n");
});

test("replaces the final section and appends a missing Lab Picture", () => {
  const { replaceLabPictureSection } = loadExtractor();
  const replacement = "# Lab Picture\n\nNew results.\n";
  assert.equal(replaceLabPictureSection(before + oldSection, "New results."), before + replacement);
  assert.equal(replaceLabPictureSection(after, "New results."), after + "\n\n" + replacement);
  assert.equal(replaceLabPictureSection("", "New results."), replacement);
});

test("handles CRLF boundaries and treats replacement dollar signs literally", () => {
  const { replaceLabPictureSection, extractLabPictureSection } = loadExtractor();
  const input = (before + oldSection + "\n\n" + after).replace(/\n/g, "\r\n");
  const out = replaceLabPictureSection(input, "Literal $& and $' text.");
  assert.equal(extractLabPictureSection(out), "# Lab Picture\n\nLiteral $& and $' text.");
  assert.ok(out.startsWith(before.replace(/\n/g, "\r\n")));
  assert.ok(out.endsWith(after.replace(/\n/g, "\r\n") + "\n"));
});

for (const finalSection of [false, true]) {
  test(`saved lab updates and deletion replace stale memory (${finalSection ? "final" : "middle"} section)`, async () => {
    const extractor = loadExtractor(before + oldSection + (finalSection ? "" : "\n\n" + after));
    const record = (value) => ({
      date: "2026-09-08", source: "Synthetic lab",
      extractedData: { panelName: "Inflammation", values: [{ name: "CRP", value, unit: "mg/L", flag: "high" }] }
    });
    extractor.setRecords([record(3.2)]);
    await extractor.updateHealthPictureWithLabResults("test-user");
    assert.match(extractor.picture, /CRP 3\.2 mg\/L/);
    assert.doesNotMatch(extractor.picture, /CRP 4\.8|Old panel details/);

    extractor.setRecords([record(2.1)]);
    await extractor.updateHealthPictureWithLabResults("test-user");
    assert.match(extractor.picture, /CRP 2\.1 mg\/L/);
    assert.doesNotMatch(extractor.picture, /CRP 3\.2|CRP 4\.8/);

    extractor.setRecords([]);
    await extractor.updateHealthPictureWithLabResults("test-user");
    assert.equal(extractor.extractLabPictureSection(extractor.picture), "# Lab Picture\n\n### Most Recent Overview\nNo lab results on file.");
    assert.equal(extractor.aiCalls, 2, "deletion must not regenerate results through AI");
    assert.ok(extractor.picture.startsWith(before));
    if (!finalSection) assert.ok(extractor.picture.endsWith(after + "\n"));
  });
}
