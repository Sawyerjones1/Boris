const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getDoctorVisitExtractionPrompt,
  normalizeDoctorVisitExtraction,
  namesAppearToMatch,
  validateDoctorVisitSummary
} = require("../core/extractor");

const VALID_SUMMARY = `# Visit Summary

- Visit date: 2026-06-17
- Provider: Avery Chen, ND
- Practice: Example Integrative Health
- Visit type: Naturopathic follow-up
- Reason for visit: Follow-up for fatigue and dizziness.

## Assessment and Findings

- Symptoms remain under evaluation.

## Tests and Monitoring Ordered

- Morning cortisol ordered through LabCorp; no result was documented.

## Referrals

- None documented.

## Medication and Supplement Discussion

- Provider recommended increasing NAC. This is a recommendation, not proof the change occurred.

## Provider Recommendations

- Continue hydration and gradual exercise.

## Follow-up Plan

- Follow up in three months.`;

test("doctor visit prompt preserves clinical distinctions", () => {
  const prompt = getDoctorVisitExtractionPrompt();
  assert.match(prompt, /ordered from completed results/i);
  assert.match(prompt, /discussed or recommended from one that was started/i);
  assert.match(prompt, /must not become a confirmed diagnosis/i);
  assert.match(prompt, /Only place a formal referral/i);
  assert.match(prompt, /do not create dose times/i);
});

test("doctor visit summary requires the standard section structure", () => {
  assert.equal(validateDoctorVisitSummary(VALID_SUMMARY), true);
  assert.equal(
    validateDoctorVisitSummary(VALID_SUMMARY.replace("## Referrals", "## Missing")),
    false
  );
});

test("patient name matching tolerates titles but catches a different patient", () => {
  assert.equal(namesAppearToMatch("Jordan Reyes", "Mr. Jordan Reyes"), true);
  assert.equal(namesAppearToMatch("Jordan Reyes", "Alex Reyes"), false);
});

test("doctor visit normalization adds a profile mismatch warning and retains source text", () => {
  const result = normalizeDoctorVisitExtraction(
    {
      visitDate: "2026-06-17",
      providerName: "Priya Patel",
      providerCredentials: "MD",
      practice: "Internal Medicine",
      visitType: "Follow-up",
      patientNameAsWritten: "Alex",
      summaryMarkdown: VALID_SUMMARY,
      warnings: []
    },
    {
      identity: "# Identity\n\n- Name: Jordan Reyes",
      date: "2026-06-17",
      source: "Dr. Patel",
      fileName: "visit.txt",
      rawText: "Dear Alex, thank you for visiting today."
    }
  );

  assert.equal(result.provider, "Priya Patel");
  assert.equal(result.sourceFileName, "visit.txt");
  assert.equal(result.rawText, "Dear Alex, thank you for visiting today.");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /does not match the current profile/i);
});

test("the documented visit date replaces a mismatched entered date with a warning", () => {
  const result = normalizeDoctorVisitExtraction(
    {
      visitDate: "2026-06-17",
      providerName: "Avery Chen",
      summaryMarkdown: VALID_SUMMARY,
      warnings: []
    },
    {
      identity: "# Identity\n\n- Name: Jordan Reyes",
      date: "2026-09-09"
    }
  );

  assert.equal(result.visitDate, "2026-06-17");
  assert.match(result.warnings[0], /document date has been selected/i);
});

test("doctor visits UI supports paste, editable review, and saved summary display", () => {
  const recordsHtml = fs.readFileSync(
    path.join(__dirname, "..", "ui", "records.html"),
    "utf8"
  );
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "ui", "assets", "app.js"),
    "utf8"
  );

  assert.match(recordsHtml, /id="records-doctor-text"/);
  assert.match(recordsHtml, /id="records-review-visit-date"/);
  assert.match(recordsHtml, /id="records-review-visit-summary"/);
  assert.match(appJs, /isDoctorVisitRecordType/);
  assert.match(appJs, /renderRichMarkdown\(data\.summaryMarkdown/);
  assert.doesNotMatch(appJs, /This page foundation is ready/);
});

test("health picture treatment stack is derived only from active database records", () => {
  const scheduler = fs.readFileSync(
    path.join(__dirname, "..", "core", "scheduler.js"),
    "utf8"
  );

  assert.match(scheduler, /activeSupplements and activePrescriptions as the exclusive source of truth/);
  assert.match(scheduler, /Never describe the upload date as the visit date/);
  assert.match(scheduler, /recentlyChangedRecords/);
});
