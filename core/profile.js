const {
  getMemoryFile,
  saveMemoryFile,
  archiveMemoryFile
} = require("./neon");

const DEFAULT_COMMUNICATION_PREFERENCES = [
  "Be direct, clinical, professional. Lead with the answer.",
  "Keep responses short (3-5 lines default). No headers unless genuinely needed.",
  "Never summarize my data back before answering - just answer.",
  "Don't repeat profile demographics unless relevant.",
  "If logged data contradicts what I say, mention it directly.",
  "If a supplement isn't logged, assume not yet taken today, not missed.",
  "Use the person's preferred name when it is available. Use bullet points. Minimal em dashes.",
  "Use message timing when relevant - you know the server's current local date/time.",
  "Check patient notes and lab values before answering health questions."
];

const DEFAULT_GOALS = [
  "Identify root cause of ongoing symptoms",
  "Gain muscle, improve cardiovascular fitness",
  "Optimize sleep, energy, recovery",
  "Prevent burnout"
];

function normalizeList(value) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatList(items) {
  if (!items.length) {
    return "- None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatInlineList(items) {
  return items.length ? items.join(", ") : "None";
}

function normalizeCareRecords(value) {
  return Array.isArray(value)
    ? value
      .map((item) => ({
        name: String(item?.name || "").trim(),
        dose: String(item?.dose || "").trim(),
        frequency: String(item?.frequency || "").trim(),
        timeOfDay: String(item?.timeOfDay || "").trim(),
        purpose: String(item?.purpose || "").trim()
      }))
      .filter((item) => item.name)
    : [];
}

function formatCareRecords(records) {
  return records.length
    ? records.map((item) => [item.name, item.dose, item.frequency, item.timeOfDay, item.purpose].filter(Boolean).join(" — "))
    : ["None"];
}

function formatField(label, value) {
  return `- ${label}: ${String(value || "").trim() || "Not provided"}`;
}

function formatRecordSection(title, records) {
  return [
    `## ${title}`,
    ...(records.length
      ? records.map((item) => {
        const details = [
          item.dose && `Dose: ${item.dose}`,
          item.frequency && `Frequency: ${item.frequency}`,
          item.timeOfDay && `Timing: ${item.timeOfDay}`,
          item.purpose && `Purpose: ${item.purpose}`
        ].filter(Boolean);
        return `- ${item.name}${details.length ? ` — ${details.join("; ")}` : ""}`;
      })
      : ["- None provided"]),
    ""
  ];
}

function buildDefaultIdentityMarkdown() {
  return [
    "# Identity",
    "- Name: Not set",
    "- DOB: Not set",
    "- Sex assigned at birth: Not set",
    "- Height: Not set",
    "- Home region: Not set",
    "",
    "# Communication Preferences",
    ...DEFAULT_COMMUNICATION_PREFERENCES.map((item) => `- ${item}`),
    "",
    "# Goals",
    ...DEFAULT_GOALS.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function buildDefaultHealthPictureMarkdown(formData = {}) {
  const medications = normalizeCareRecords(formData.medications);
  const supplements = normalizeCareRecords(formData.supplements);
  const conditions = normalizeList(formData.conditions);
  const allergies = normalizeList(formData.allergies);
  const symptoms = normalizeList(formData.symptoms);
  const providers = normalizeList(formData.providers);
  const medicalContext = String(formData.medicalContext || "").trim();
  const observations = String(formData.observations || "").trim();
  const recentChanges = String(formData.recentChanges || "").trim();
  const goals = normalizeList(formData.goals);
  const foodPattern = String(formData.foodPattern || "").trim();
  const routine = String(formData.routine || "").trim();
  const work = String(formData.work || "").trim();
  const weight = String(formData.weight || "").trim();

  return [
    "# Current Supplement Stack",
    "## Prescriptions",
    ...formatCareRecords(medications).map((item) => `- ${item}`),
    "",
    "## Supplements",
    ...formatCareRecords(supplements).map((item) => `- ${item}`),
    "",
    "# Active Patterns",
    "- Tracking has just begun; there is not enough dated information to establish a pattern yet.",
    ...(observations ? [`- User-reported factors to monitor: ${observations}`] : []),
    ...(foodPattern ? [`- Current food pattern: ${foodPattern}`] : []),
    ...(routine ? [`- Current typical day: ${routine}`] : []),
    ...(work ? [`- Current weekday commitments: ${work}`] : []),
    "",
    "# Lab Picture",
    "- No lab results have been added yet.",
    "",
    "# Current Concerns",
    medicalContext ? `- ${medicalContext}` : "- No primary concern documented yet.",
    ...(conditions.length ? [`- Reported diagnoses or current conditions: ${formatInlineList(conditions)}`] : []),
    ...(allergies.length ? [`- Reported allergies or adverse reactions: ${formatInlineList(allergies)}`] : []),
    ...(symptoms.length ? [`- Symptoms being tracked: ${formatInlineList(symptoms)}`] : []),
    ...(recentChanges ? [`- User-reported recent changes: ${recentChanges}`] : []),
    ...(providers.length ? [`- Current care team: ${formatInlineList(providers)}`] : []),
    ...(weight ? [`- Current reported weight at onboarding: ${weight}`] : []),
    ...(goals.length ? [`- Health goals: ${formatInlineList(goals)}`] : []),
    ""
  ].join("\n");
}

function buildIdentityMarkdown(formData) {
  const location = String(formData.location || "").trim() || "Not set";
  const communicationPreference = String(formData.communicationPreference || "").trim();
  const goals = normalizeList(formData.goals);

  return [
    "# Identity",
    `- Name: ${String(formData.name || "").trim()}`,
    `- DOB: ${String(formData.birthday || "").trim()}`,
    `- Sex assigned at birth: ${String(formData.sex || "").trim() || "Not set"}`,
    `- Height: ${String(formData.height || "").trim() || "Not set"}`,
    `- Home region: ${location}`,
    "",
    "# Communication Preferences",
    ...DEFAULT_COMMUNICATION_PREFERENCES.map((item) => `- ${item}`),
    ...(communicationPreference ? [`- ${communicationPreference}`] : []),
    "",
    "# Goals",
    ...(goals.length ? goals : DEFAULT_GOALS).map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function buildOnboardingSnapshotMarkdown(formData) {
  const medications = normalizeCareRecords(formData.medications);
  const supplements = normalizeCareRecords(formData.supplements);

  return [
    "# Onboarding Snapshot",
    "This document preserves the information the user submitted during onboarding. It is source context, not a generated medical conclusion.",
    "",
    "## Baseline",
    formatField("Preferred name", formData.name),
    formatField("Date of birth", formData.birthday),
    formatField("Sex assigned at birth", formData.sex),
    formatField("Height", formData.height),
    formatField("Weight", formData.weight),
    formatField("Home region", formData.location),
    "",
    "## Daily Context",
    formatField("Weekday commitments", formData.work),
    formatField("Typical day", formData.routine),
    formatField("Food pattern or considerations", formData.foodPattern),
    "",
    "## Health Context",
    formatField("Reason for tracking", formData.medicalContext),
    formatField("Symptoms to track", formatInlineList(normalizeList(formData.symptoms))),
    formatField("Diagnoses or current conditions", formatInlineList(normalizeList(formData.conditions))),
    formatField("Allergies or adverse reactions", formatInlineList(normalizeList(formData.allergies))),
    formatField("Reported factors to monitor", formData.observations),
    formatField("Recent changes", formData.recentChanges),
    formatField("Desired outcomes", formatInlineList(normalizeList(formData.goals))),
    "",
    "## Care Context",
    ...formatRecordSection("Medications", medications),
    ...formatRecordSection("Supplements", supplements),
    formatField("Care team", formatInlineList(normalizeList(formData.providers))),
    "",
    "## Communication Preference Submitted",
    `- ${String(formData.communicationPreference || "").trim() || "No additional preference provided"}`,
    ""
  ].join("\n");
}

function normalizeIdentitySection(section) {
  return String(section || "").trim();
}

function normalizeIdentityAppendContent(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) =>
      /^[-*]\s+/.test(line) ? `- ${line.replace(/^[-*]\s+/, "").trim()}` : `- ${line}`
    );
}

async function readIdentity(userId) {
  return getMemoryFile(userId, "identity");
}

async function readHealthPicture(userId) {
  return getMemoryFile(userId, "health-picture");
}

async function readOnboardingSnapshot(userId) {
  return getMemoryFile(userId, "onboarding");
}

async function updateIdentity(userId, content) {
  const normalized = String(content || "").trim() || buildDefaultIdentityMarkdown().trim();
  await saveMemoryFile(userId, "identity", normalized);
  return normalized;
}

async function appendToIdentitySection(userId, section, content) {
  const normalizedSection = normalizeIdentitySection(section);
  const normalizedLines = normalizeIdentityAppendContent(content);
  const allowedSections = new Set([
    "Identity",
    "Communication Preferences",
    "Goals"
  ]);

  if (!allowedSections.has(normalizedSection)) {
    const error = new Error("That identity section is not supported.");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedLines.length) {
    const error = new Error("A note to append is required.");
    error.statusCode = 400;
    throw error;
  }

  const existing = await readIdentity(userId);
  const lines = String(existing || "").replace(/\r\n/g, "\n").split("\n");
  const heading = `# ${normalizedSection}`;
  const headingIndex = lines.findIndex((line) => line.trim() === heading);

  if (headingIndex === -1) {
    const error = new Error(
      `The "${normalizedSection}" section does not exist in identity.md. Add it manually first.`
    );
    error.statusCode = 400;
    throw error;
  }

  let nextHeadingIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("# ")) {
      nextHeadingIndex = index;
      break;
    }
  }

  let insertAt = nextHeadingIndex;
  while (insertAt > headingIndex + 1 && !String(lines[insertAt - 1] || "").trim()) {
    insertAt -= 1;
  }

  lines.splice(insertAt, 0, ...normalizedLines);
  const updated = `${lines.join("\n").trimEnd()}\n`;
  await saveMemoryFile(userId, "identity", updated);
  return updated;
}

async function writeHealthPicture(userId, content) {
  const normalized =
    String(content || "").trim() || buildDefaultHealthPictureMarkdown().trim();
  await saveMemoryFile(userId, "health-picture", normalized);
  return normalized;
}

async function archiveHealthPicture(userId, label) {
  const archiveLabel = String(label || "").trim();

  if (!archiveLabel) {
    const error = new Error("An archive label is required.");
    error.statusCode = 400;
    throw error;
  }

  const current = await readHealthPicture(userId);
  await archiveMemoryFile(
    userId,
    "health-picture",
    archiveLabel,
    String(current).trimEnd()
  );
  return archiveLabel;
}

async function appendHealthPictureNote(
  userId,
  note,
  timestamp = new Date().toISOString()
) {
  const normalizedNote = String(note || "").trim();

  if (!normalizedNote) {
    const error = new Error("A note is required.");
    error.statusCode = 400;
    throw error;
  }

  const existingHealthPicture = await readHealthPicture(userId);
  const manualNotesHeader = "## Manual Notes";
  const manualEntry = [`### ${timestamp}`, normalizedNote].join("\n");
  let nextContent = String(existingHealthPicture || "").trimEnd();

  if (new RegExp(`^${manualNotesHeader}$`, "im").test(nextContent)) {
    nextContent = `${nextContent}\n\n${manualEntry}\n`;
  } else {
    nextContent = `${nextContent}\n\n${manualNotesHeader}\n\n${manualEntry}\n`;
  }

  await writeHealthPicture(userId, nextContent);
}

async function isProfileComplete(userId) {
  try {
    const identity = await readIdentity(userId);
    const requiredPatterns = [
      /^- Name:\s*(.+)\s*$/m,
      /^- DOB:\s*(.+)\s*$/m,
      /^# Goals\s*\n\s*-\s*(.+)\s*$/m
    ];

    return requiredPatterns.every((pattern) => {
      const match = identity.match(pattern);
      const value = String(match?.[1] || "").trim();
      return Boolean(value && !/^not set$/i.test(value));
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeOnboardingFiles(userId, formData) {
  const identityMarkdown = buildIdentityMarkdown(formData);
  const healthPictureMarkdown = buildDefaultHealthPictureMarkdown(formData);
  const onboardingSnapshotMarkdown = buildOnboardingSnapshotMarkdown(formData);
  await Promise.all([
    saveMemoryFile(userId, "identity", identityMarkdown),
    saveMemoryFile(userId, "health-picture", healthPictureMarkdown),
    saveMemoryFile(userId, "onboarding", onboardingSnapshotMarkdown)
  ]);

  return {
    identityMarkdown,
    healthPictureMarkdown,
    onboardingSnapshotMarkdown
  };
}

module.exports = {
  buildDefaultHealthPictureMarkdown,
  buildDefaultIdentityMarkdown,
  buildIdentityMarkdown,
  buildOnboardingSnapshotMarkdown,
  appendHealthPictureNote,
  archiveHealthPicture,
  isProfileComplete,
  readHealthPicture,
  readIdentity,
  readOnboardingSnapshot,
  appendToIdentitySection,
  updateIdentity,
  writeHealthPicture,
  writeOnboardingFiles
};
