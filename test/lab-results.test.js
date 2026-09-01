const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  getLabPictureSummaryInstructions,
  buildLabPictureSummaryInput
} = require("../core/extractor");

test("lab picture summary uses saved identity instead of a fixed demographic", () => {
  const instructions = getLabPictureSummaryInstructions();
  const input = JSON.parse(buildLabPictureSummaryInput(
    "# Identity\n- Name: Avery Morgan\n- DOB: 1998-04-16",
    [{ heading: "Aug 24, 2026 - Vitamin D", body: "Vitamin D 23 ng/mL (low)." }]
  ));

  assert.doesNotMatch(instructions, /26 year old male/i);
  assert.match(instructions, /do not infer demographics/i);
  assert.match(input.patientIdentity, /Avery Morgan/);
  assert.equal(input.panelEntries[0].heading, "Aug 24, 2026 - Vitamin D");
});
