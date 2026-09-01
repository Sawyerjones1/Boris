const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildDefaultHealthPictureMarkdown,
  buildIdentityMarkdown,
  buildOnboardingSnapshotMarkdown
} = require("../core/profile");

const onboarding = {
  name: "Avery Morgan",
  birthday: "1996-04-12",
  sex: "Female",
  height: "5 ft 6 in",
  weight: "142 lb",
  location: "Portland, OR",
  work: "Remote product design",
  routine: "Desk work followed by an evening walk",
  foodPattern: "Mostly home-cooked meals",
  medicalContext: "Understand intermittent digestive symptoms",
  symptoms: "Bloating\nBrain fog",
  conditions: "Digestive symptoms under evaluation",
  allergies: "None known",
  observations: "Symptoms may coincide with restaurant lunches",
  recentChanges: "Started keeping a food log",
  goals: "Identify useful patterns",
  providers: "Jordan Lee, NP",
  medications: [{ name: "Example Rx", dose: "5 mg", frequency: "Daily" }],
  supplements: [{ name: "Magnesium", dose: "200 mg", frequency: "Daily", timeOfDay: "Evening" }]
};

test("onboarding keeps stable identity separate from changing health context", () => {
  const identity = buildIdentityMarkdown(onboarding);
  const snapshot = buildOnboardingSnapshotMarkdown(onboarding);

  assert.match(identity, /- Name: Avery Morgan/);
  assert.match(identity, /- Home region: Portland, OR/);
  assert.match(identity, /# Communication Preferences/);
  assert.match(identity, /# Goals/);
  assert.doesNotMatch(identity, /142 lb|Bloating|Example Rx|Remote product design/);

  assert.match(snapshot, /# Onboarding Snapshot/);
  assert.match(snapshot, /- Weight: 142 lb/);
  assert.match(snapshot, /- Symptoms to track: Bloating, Brain fog/);
  assert.match(snapshot, /- Example Rx .*Dose: 5 mg; Frequency: Daily/);
  assert.match(snapshot, /- Magnesium .*Dose: 200 mg; Frequency: Daily; Timing: Evening/);
});

test("initial health picture uses only supplied treatment details", () => {
  const healthPicture = buildDefaultHealthPictureMarkdown(onboarding);

  assert.match(healthPicture, /# Current Supplement Stack/);
  assert.match(healthPicture, /- Example Rx .*5 mg.*Daily/);
  assert.match(healthPicture, /- Magnesium .*200 mg.*Daily.*Evening/);
  assert.doesNotMatch(healthPicture, /commonly|often for|no missed doses|no changes this week/i);
  assert.match(healthPicture, /User-reported factors to monitor/);
  assert.match(healthPicture, /not enough dated information to establish a pattern/i);
});
