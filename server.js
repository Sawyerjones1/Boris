require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");

const { isPlainObject } = require("./core/utils");

const {
  getOpenAIClient,
  createTrackedResponse,
  buildOpenAIMeta,
  setSessionId,
  setApiContext
} = require("./core/api");
const {
  classifyAndParse,
  getDoctorResponse,
  buildDoctorDataPlan,
  buildLogConfirmation,
  startDailyRecap,
  getNextRecapQuestion,
  buildRecapQuestion,
  buildPatchFromStructuredAnswer,
  appendToThread,
  parseAutomationRequest
} = require("./core/chat");
const {
  getTodayDateString,
  isValidDateString,
  createEmptyDailyLog,
  initScheduler,
  regenerateHealthPicture,
  generateMorningBrief,
  runDailySummaryWithCompression,
  readRecentSummaries
} = require("./core/scheduler");
const {
  APP_TIMEZONE,
  addDaysToDateString,
  formatDisplayDate
} = require("./core/time");
const { getActiveUser } = require("./core/db");
const {
  initSchema,
  getLog,
  updateLog,
  getDateRange,
  getMonthlyAverages,
  getFlareDays,
  getGoodDays,
  getSupplementHistory,
  getBestDays,
  getWorstDays,
  comparePeriods,
  getMemoryFileRecord,
  getUserList,
  saveUserList,
  getVisitedPages,
  markPageVisited,
  saveSummary,
  getSummary,
  listSummaries,
  getThread,
  getApiLogs,
  getApiLog,
  getApiLogSummary,
  truncateOldLogs,
  getRecurringSchedules,
  getUpcomingCalendarEvents,
  saveLabResult,
  updateLabResult,
  getLabResults,
  getLabResult,
  deleteLabResult,
  getLatestLabValues,
  savePrescription,
  getPrescriptions,
  getActivePrescriptions,
  getPrescription,
  updatePrescription,
  deletePrescription,
  saveSupplement,
  getSupplements,
  getActiveSupplements,
  getSupplement,
  updateSupplement,
  deleteSupplement,
  getNutrientRollup,
  saveDoctorVisit,
  getDoctorVisits,
  getDoctorVisit,
  updateDoctorVisit,
  deleteDoctorVisit
} = require("./core/neon");
const { getWeatherForDate } = require("./core/weather");
const { buildTrends } = require("./core/trends");
const { sendTelegramMessage, startTelegramPolling } = require("./core/telegram");
const {
  getAutomations,
  createAutomation,
  ensureDefaultMorningBrief,
  updateAutomation,
  deleteAutomation,
  getAutomationRuns,
  runAutomationNow,
  startAutomationRunner,
  formatAutomationSchedule
} = require("./core/automations");
const {
  getGoogleConnection,
  upsertGoogleConnection,
  deleteGoogleConnection,
  getRecurringSchedules: getStoredRecurringSchedules,
  createRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  getPlanningPreferences,
  upsertPlanningPreferences,
  getCalendarEvents,
  replaceCalendarEvents
} = require("./core/schedules");
const {
  getGoogleAuthUrl,
  consumeAuthState,
  exchangeCodeForTokens,
  syncGoogleCalendar
} = require("./core/google");
const {
  extractLabResults,
  extractSupplementLabel,
  extractDoctorVisit,
  updateHealthPictureWithLabResults,
  validateDoctorVisitSummary
} = require("./core/extractor");
const { parseHealthInput } = require("./core/parser");
const {
  readIdentity,
  readHealthPicture,
  updateIdentity,
  appendToIdentitySection,
  appendHealthPictureNote,
  writeHealthPicture,
  isProfileComplete,
  writeOnboardingFiles
} = require("./core/profile");

const app = express();
app.disable("x-powered-by");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
    fields: 20,
    parts: 21
  }
});
const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const UI_DIR = path.join(ROOT_DIR, "ui");
const SUMMARY_TYPES = ["daily", "weekly", "monthly", "quarterly", "yearly"];
const ONBOARDING_HEALTH_PICTURE_MODEL = "gpt-4.1-mini";
const HEALTH_PICTURE_SECTIONS = [
  "# Current Supplement Stack",
  "# Active Patterns",
  "# Lab Picture",
  "# Current Concerns"
];
const RECORD_TYPES = new Set([
  "lab_results",
  "doctor_visit",
  "prescription",
  "supplement"
]);
const telegramSessions = new Map();
const automationDependencies = {
  generateMorningBrief,
  sendTelegramMessage
};

function logEvent(message, details) {
  if (details) {
    console.log(`[Boris] ${message}`, details);
    return;
  }

  console.log(`[Boris] ${message}`);
}

async function refreshHealthPictureAfterLabChange(userId, action) {
  try {
    await updateHealthPictureWithLabResults(userId);
    return true;
  } catch (error) {
    console.error(`[Boris] Lab ${action} completed, but Health Picture refresh failed`, error);
    return false;
  }
}

async function refreshHealthPictureAfterDoctorVisitChange(userId, action) {
  try {
    await regenerateHealthPicture(userId);
    return true;
  } catch (error) {
    console.error(`[Boris] Doctor visit ${action} completed, but Health Picture refresh failed`, error);
    return false;
  }
}

function isValidHealthPicture(content) {
  const headings = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#\s+/.test(line));

  return headings.length === HEALTH_PICTURE_SECTIONS.length &&
    headings.every((heading, index) => heading === HEALTH_PICTURE_SECTIONS[index]);
}

async function generateInitialHealthPicture(
  formData,
  identityMarkdown,
  onboardingSnapshotMarkdown,
  fallbackHealthPicture
) {
  if (!getOpenAIClient()) {
    return {
      content: fallbackHealthPicture,
      generated: false
    };
  }

  setApiContext("onboarding", "/onboarding");
  const { response } = await createTrackedResponse(
    {
      model: ONBOARDING_HEALTH_PICTURE_MODEL,
      instructions: `You are creating the initial health-picture.md for Boris, a personal health agent. Use only the submitted onboarding data. This is a concise current-state memory file for future conversations, not a diagnosis, treatment plan, or general health article.

Rules:
- Output Markdown only, with exactly these top-level sections in this order:
  1. # Current Supplement Stack
  2. # Active Patterns
  3. # Lab Picture
  4. # Current Concerns
- Use crisp bullets and stay under 600 tokens.
- Preserve facts faithfully. Do not invent diagnoses, test results, providers, medications, symptom severity, or patterns.
- Preserve the user's diagnostic wording and uncertainty. Do not turn a reported condition into a stronger or chronic diagnosis.
- Never add a common, typical, or inferred purpose for a medication or supplement. Include a purpose only when the user supplied one; otherwise omit it or say "purpose not provided."
- Do not claim adherence, missed doses, treatment changes, activity, substance use, or dietary behavior beyond what the onboarding submission explicitly says.
- Treat missing information as unknown. Do not convert a missing log or field into a negative finding.
- Do not claim that one change caused an improvement or symptom. Label submitted relationships as user-reported observations to monitor.
- The person has no longitudinal data yet. In Active Patterns, say that tracking has just begun, then name the submitted questions or relationships worth observing without implying a finding or causation.
- In Lab Picture, state that no lab results have been added unless the onboarding data explicitly includes one.
- In Current Supplement Stack, list submitted medications and supplements with dose, frequency, timing, and purpose when supplied. If none were supplied, say that none are documented yet.
- In Current Concerns, capture the stated reason for tracking, conditions, allergies, symptoms to track, food considerations, the person's initial observations, recent changes, goals, and relevant care context when provided.
- Use careful language such as "to track" or "to discuss with a clinician". Do not give medical advice or claim a medical conclusion.`,
      input: JSON.stringify(
        {
          identity: identityMarkdown,
          onboardingSnapshot: onboardingSnapshotMarkdown,
          onboarding: formData
        },
        null,
        2
      )
    },
    {
      label: "creating initial health picture"
    }
  );

  const content = String(response?.output_text || "").trim();

  if (!isValidHealthPicture(content)) {
    throw new Error("The initial health picture response did not use the required format.");
  }

  return {
    content,
    generated: true
  };
}

function withOpenAIMeta(payload, usageItems) {
  const openai = buildOpenAIMeta(usageItems);

  if (!openai) {
    return payload;
  }

  return {
    ...payload,
    _meta: {
      ...(payload?._meta || {}),
      openai
    }
  };
}

function sendError(res, statusCode, message, error) {
  if (error) {
    console.error(`[Boris] ${message}`, error);
  } else {
    console.error(`[Boris] ${message}`);
  }

  res.status(statusCode).json({
    error: message
  });
}

function getErrorStatusCode(error, fallback = 500) {
  return Number(error?.statusCode) || fallback;
}

function sendCaughtError(res, fallbackMessage, error, fallbackStatusCode = 500) {
  const statusCode = getErrorStatusCode(error, fallbackStatusCode);
  const message = error?.message || fallbackMessage;
  return sendError(res, statusCode, message, error);
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!String(body[field] || "").trim()) {
      return field;
    }
  }

  return null;
}


function uniqueStrings(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const value = String(item || "").trim();
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function getSymptomsFromIdentity(identity) {
  const match = String(identity || "").match(/^\s*-\s*Symptoms to track:\s*(.+?)\s*$/m);
  const value = String(match?.[1] || "").trim();

  if (!value || /^(none|not set)$/i.test(value)) {
    return [];
  }

  return uniqueStrings(value.split(","));
}

function parseBooleanQuery(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function messageRequestsTelegramSend(message) {
  const normalized = String(message || "").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /send (it|this|that|the summary|the response)?\s*(to )?(my )?telegram/,
    /text (it|this|that|me) (to )?(my )?telegram/,
    /send .*telegram as well/,
    /telegram as well/,
    /also send .*telegram/
  ].some((pattern) => pattern.test(normalized));
}

function hasConfiguredTelegramDelivery() {
  return Boolean(
    String(process.env.TELEGRAM_BOT_TOKEN || "").trim() &&
    String(
      process.env.TELEGRAM_ALLOWED_CHAT_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      ""
    ).trim()
  );
}

function validateRecordType(type) {
  const normalized = String(type || "").trim().toLowerCase();

  if (!RECORD_TYPES.has(normalized)) {
    const error = new Error(
      "Invalid record type. Use lab_results, doctor_visit, prescription, or supplement."
    );
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function getRecordsByType(userId, type) {
  switch (validateRecordType(type)) {
    case "lab_results":
      return getLabResults(userId);
    case "prescription":
      return getPrescriptions(userId);
    case "supplement":
      return getSupplements(userId);
    case "doctor_visit":
      return getDoctorVisits(userId);
    default:
      return [];
  }
}

async function getRecordById(userId, recordId, typeHint = null) {
  const normalizedId = String(recordId || "").trim();
  const normalizedTypeHint = typeHint ? validateRecordType(typeHint) : null;

  if (!normalizedId) {
    const error = new Error("A recordId is required.");
    error.statusCode = 400;
    throw error;
  }

  const lookups = normalizedTypeHint
    ? [normalizedTypeHint]
    : ["lab_results", "prescription", "supplement", "doctor_visit"];

  for (const type of lookups) {
    let record = null;

    if (type === "lab_results") {
      record = await getLabResult(userId, normalizedId);
    } else if (type === "prescription") {
      record = await getPrescription(userId, normalizedId);
    } else if (type === "supplement") {
      record = await getSupplement(userId, normalizedId);
    } else if (type === "doctor_visit") {
      record = await getDoctorVisit(userId, normalizedId);
    }

    if (record) {
      return record;
    }
  }

  return null;
}

async function deleteRecordById(userId, recordId, typeHint = null) {
  const existing = await getRecordById(userId, recordId, typeHint);

  if (!existing) {
    return null;
  }

  if (existing.type === "lab_results") {
    await deleteLabResult(userId, recordId);
  } else if (existing.type === "prescription") {
    await deletePrescription(userId, recordId);
  } else if (existing.type === "supplement") {
    await deleteSupplement(userId, recordId);
  } else if (existing.type === "doctor_visit") {
    await deleteDoctorVisit(userId, recordId);
  }

  return existing;
}

function wantsMarkdownResponse(req) {
  return (
    req.get("X-Boris-Content") === "markdown" ||
    (req.get("Accept") || "").includes("text/markdown")
  );
}

function normalizeSummaryType(type) {
  const normalized = String(type || "").trim().toLowerCase();

  if (!SUMMARY_TYPES.includes(normalized)) {
    const error = new Error("Invalid summary type.");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function buildSummaryItem(type, period, createdAt = null, editedManually = false) {
  const baseName = String(period || "").trim();
  const item = {
    type,
    fileName: `${baseName}.md`,
    period: baseName,
    label: baseName,
    createdAt,
    editedManually
  };

  if (type === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(baseName)) {
    item.date = baseName;
    item.monthKey = baseName.slice(0, 7);
    item.monthLabel = formatDisplayDate(`${item.monthKey}-01`, { includeDay: false });
    item.label = formatDisplayDate(baseName);
  }

  if (type === "weekly") {
    const dateMatch = baseName.match(/\d{4}-\d{2}-\d{2}/);
    item.label = dateMatch ? `Week of ${formatDisplayDate(dateMatch[0])}` : baseName;
  }

  if (type === "monthly" && /^\d{4}-\d{2}$/.test(baseName)) {
    item.label = formatDisplayDate(`${baseName}-01`, { includeDay: false });
  }

  if (type === "quarterly") {
    const quarterMatch = baseName.match(/^(\d{4})-Q([1-4])$/i);
    item.label = quarterMatch ? `Q${quarterMatch[2]} ${quarterMatch[1]}` : baseName;
  }

  if (type === "yearly" && /^\d{4}$/.test(baseName)) {
    item.label = baseName;
  }

  return item;
}

async function readSummaryList(userId) {
  const result = {};

  for (const type of SUMMARY_TYPES) {
    const items = await listSummaries(userId, type);
    result[type] = items.map((item) =>
      buildSummaryItem(
        type,
        item.period,
        item.created_at || null,
        item.edited_manually === true
      )
    );
  }

  return result;
}

async function getCurrentUserId() {
  return getActiveUser();
}

async function estimateMacros(description) {
  const client = getOpenAIClient();

  if (!client) {
    const error = new Error("OPENAI_API_KEY is not set, so macro estimation is unavailable.");
    error.statusCode = 503;
    throw error;
  }

  setApiContext("macros", "/estimate/macros");

  const { response, usage } = await createTrackedResponse({
    model: "gpt-4.1-mini",
    instructions:
      "You are a nutrition expert. Given a meal description, return ONLY a JSON object with these fields: calories (number), protein (number in grams), carbs (number in grams), fat (number in grams), confidence (low/medium/high). Return nothing else, no markdown, no explanation.",
    input: JSON.stringify({ description }, null, 2)
  }, {
    label: "estimating macros"
  });

  const output = String(response.output_text || "").trim();

  if (!output) {
    throw new Error("OpenAI returned an empty macro estimate.");
  }

  let parsed;

  try {
    parsed = JSON.parse(output);
  } catch (_error) {
    throw new Error("Could not estimate macros");
  }

  const estimate = {
    calories: Number(parsed.calories),
    protein: Number(parsed.protein),
    carbs: Number(parsed.carbs),
    fat: Number(parsed.fat),
    confidence: String(parsed.confidence || "").trim().toLowerCase(),
    _openaiUsage: usage ? [usage] : []
  };

  if (
    !Number.isFinite(estimate.calories) ||
    !Number.isFinite(estimate.protein) ||
    !Number.isFinite(estimate.carbs) ||
    !Number.isFinite(estimate.fat) ||
    !["low", "medium", "high"].includes(estimate.confidence)
  ) {
    throw new Error("Could not estimate macros");
  }

  return estimate;
}

function getEntryNames(items) {
  return Array.isArray(items)
    ? items
        .map((entry) =>
          typeof entry === "string" ? entry : String(entry?.name || "").trim()
        )
        .filter(Boolean)
    : [];
}

async function readRecentDailySummaries(userId) {
  const today = getTodayDateString();
  const cutoff = addDaysToDateString(today, -6);
  const items = await listSummaries(userId, "daily");
  const eligible = items.filter((item) => item.period >= cutoff && item.period <= today);

  if (!eligible.length) {
    return [];
  }

  const results = await Promise.all(
    eligible.map(async (item) => {
      const summary = await getSummary(userId, "daily", item.period);
      return summary?.content
        ? { fileName: `${item.period}.md`, content: summary.content }
        : null;
    })
  );

  return results.filter(Boolean);
}

async function readLatestWeeklySummary(userId) {
  const items = await listSummaries(userId, "weekly");
  if (!items.length) return [];
  const latest = items[0];
  const summary = await getSummary(userId, "weekly", latest.period);
  return summary?.content ? [{ fileName: `${latest.period}.md`, content: summary.content }] : [];
}

function getMedicationNameFromRecord(record) {
  return String(record?.extractedData?.medicationName || "").trim();
}

function getMedicationDoseFromRecord(record) {
  return String(record?.extractedData?.dose || "").trim();
}

function isRecordActive(record) {
  return record?.extractedData?.active !== false;
}

function mapActiveMedicationRecords(records) {
  const seen = new Set();
  const items = [];

  for (const record of Array.isArray(records) ? records : []) {
    if (!isRecordActive(record)) {
      continue;
    }

    const name = getMedicationNameFromRecord(record);
    const key = name.toLowerCase();

    if (!name || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({
      name,
      dose: getMedicationDoseFromRecord(record) || null,
      recordId: record.recordId
    });
  }

  return items;
}

async function getTrackingLists(userId, existingLog) {
  const existingSupplementNames = getEntryNames(existingLog?.supplements);
  const existingSymptomNames = getEntryNames(existingLog?.symptoms);
  const [supplementRecords, prescriptionRecords, symptomsList] = await Promise.all([
    getActiveSupplements(userId).catch(() => []),
    getActivePrescriptions(userId).catch(() => []),
    getUserList(userId, "symptoms").catch(() => [])
  ]);

  const activeSupplements = mapActiveMedicationRecords(supplementRecords).map(
    (item) => item.name
  );
  const activePrescriptions = mapActiveMedicationRecords(prescriptionRecords).map(
    (item) => item.name
  );
  const supplementsList = uniqueStrings([
    ...activeSupplements,
    ...activePrescriptions,
    ...existingSupplementNames
  ]);
  const nextSymptomsList = uniqueStrings([
    ...(Array.isArray(symptomsList) ? symptomsList : []),
    ...existingSymptomNames
  ]);

  return { supplementsList, symptomsList: nextSymptomsList };
}

async function syncMasterLists(userId, masterUpdates, currentLists) {
  const nextSymptoms = uniqueStrings([
    ...(currentLists?.symptomsList || []),
    ...(masterUpdates?.symptoms || [])
  ]);

  if (masterUpdates?.symptoms?.length) {
    await saveUserList(userId, "symptoms", nextSymptoms);
  }

  return {
    supplementsList: uniqueStrings(currentLists?.supplementsList || []),
    symptomsList: nextSymptoms
  };
}

async function getTodayLogOrEmpty(userId) {
  const date = getTodayDateString();
  return (await getLog(userId, date)) || createEmptyDailyLog(date);
}

async function collectDoctorRelevantData(userId, message, supplementsList) {
  const plan = buildDoctorDataPlan(message, supplementsList);
  logEvent("Doctor data plan", plan);

  const last7Start = addDaysToDateString(plan.today, -6);
  const previous7Start = addDaysToDateString(plan.today, -13);
  const previous7End = addDaysToDateString(plan.today, -7);

  const relevantData = {
    today: plan.today,
    includeAllLabValues: plan.includeAllLabValues === true,
    todayLog: await getTodayLogOrEmpty(userId),
    last7Days: await getDateRange(userId, last7Start, plan.today),
    monthlyAverages: await getMonthlyAverages(userId, plan.currentMonth)
  };

  if (plan.includeFlareDays) {
    relevantData.flareDays = await getFlareDays(userId, plan.currentMonth);
  }

  if (plan.includeGoodDays) {
    relevantData.goodDays = await getGoodDays(userId, plan.currentMonth);
  }

  if (plan.includeBestDays) {
    relevantData.bestDays = await getBestDays(userId, 5);
  }

  if (plan.includeWorstDays) {
    relevantData.worstDays = await getWorstDays(userId, 5);
  }

  if (plan.includeCompare) {
    relevantData.periodComparison = await comparePeriods(
      userId,
      last7Start,
      plan.today,
      previous7Start,
      previous7End
    );
  }

  if (Array.isArray(plan.supplementNames) && plan.supplementNames.length) {
    relevantData.supplementHistory = {};

    for (const supplementName of plan.supplementNames) {
      relevantData.supplementHistory[supplementName] = await getSupplementHistory(
        userId,
        supplementName
      );
    }
  }

  return relevantData;
}

function stripChatMeta(parsedData) {
  const { _logged, _parsed, _masterUpdates, ...storagePatch } = parsedData || {};
  return {
    storagePatch,
    loggedData: _logged || null,
    parsedNote: _parsed || null,
    masterUpdates: _masterUpdates || null
  };
}

async function buildDoctorModeReply(
  userId,
  message,
  conversationHistory,
  supplementsList,
  contextDepth = "recent"
) {
  const today = getTodayDateString();
  const toDate = addDaysToDateString(today, 7);
  const [identity, healthPicture, recentDailyInsights, latestWeekly, relevantData, latestLabValues, activePrescriptions, doctorVisits, recurringSchedules, upcomingEvents, summaryHierarchy] = await Promise.all([
    readIdentity(userId),
    readHealthPicture(userId),
    readRecentDailySummaries(userId),
    readLatestWeeklySummary(userId).catch(() => []),
    collectDoctorRelevantData(userId, message, supplementsList),
    getLatestLabValues(userId).catch((error) => {
      console.error("[Boris] Failed to load latest lab values", error);
      return [];
    }),
    getActivePrescriptions(userId).catch((error) => {
      console.error("[Boris] Failed to load active prescriptions", error);
      return [];
    }),
    getDoctorVisits(userId).catch((error) => {
      console.error("[Boris] Failed to load doctor visits", error);
      return [];
    }),
    getRecurringSchedules(userId).catch((error) => {
      console.error("[Boris] Failed to load recurring schedules", error);
      return [];
    }),
    getUpcomingCalendarEvents(userId, today, toDate).catch((error) => {
      console.error("[Boris] Failed to load upcoming calendar events", error);
      return [];
    }),
    contextDepth === "historical"
      ? readRecentSummaries(userId).catch((error) => {
          console.error("[Boris] Failed to load summary hierarchy", error);
          return { dailies: [], weeklies: [], monthlies: [], quarterlies: [] };
        })
      : Promise.resolve(null)
  ]);

  const summaryContext =
    contextDepth === "historical"
      ? {
          dailies: recentDailyInsights,
          weeklies: summaryHierarchy?.weeklies || [],
          monthlies: summaryHierarchy?.monthlies || [],
          quarterlies: summaryHierarchy?.quarterlies || []
        }
      : {
          dailies: recentDailyInsights,
          weeklies: latestWeekly,
          monthlies: [],
          quarterlies: []
        };

  const doctorResult = await getDoctorResponse(
    message,
    identity,
    healthPicture,
    relevantData.todayLog,
    summaryContext,
    relevantData,
    conversationHistory,
    latestLabValues,
    contextDepth,
    activePrescriptions,
    {
      recurringSchedules,
      upcomingEvents,
      doctorVisits: doctorVisits.slice(0, 6)
    }
  );

  return {
    response: doctorResult.response,
    relevantData,
    _openaiUsage: doctorResult._openaiUsage || []
  };
}

async function processChatMessage({
  userId,
  mode = "free",
  message,
  conversationHistory = [],
  recapState = {}
}) {
  const normalizedMode = String(mode || "free").trim().toLowerCase();
  const normalizedMessage = String(message || "").trim();

  if (!["free", "recap", "doctor"].includes(normalizedMode)) {
    const error = new Error("Invalid chat mode.");
    error.statusCode = 400;
    throw error;
  }

  if (!normalizedMessage) {
    const error = new Error("The 'message' field is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    setSessionId(`chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  const automationRequest = await parseAutomationRequest(
    normalizedMessage,
    conversationHistory
  );

  if (automationRequest) {
    if (automationRequest.needsClarification || !automationRequest.automation) {
      return {
        response: automationRequest.clarificationQuestion,
        type: "automation",
        loggedData: null,
        nextQuestion: null,
        recapDone: false,
        _openaiUsage: automationRequest._openaiUsage || []
      };
    }

    const automation = await createAutomation(userId, automationRequest.automation);
    const deliveryReady = hasConfiguredTelegramDelivery();
    const deliveryNote = deliveryReady
      ? "It will be sent through Telegram."
      : "It is saved, but Telegram delivery needs to be configured before it can send.";

    return {
      response: `Saved **${automation.name}** for ${formatAutomationSchedule(automation)}. ${deliveryNote} You can edit it on the [Automations page](/automations).`,
      type: "automation",
      loggedData: null,
      nextQuestion: null,
      recapDone: false,
      _openaiUsage: automationRequest._openaiUsage || []
    };
  }

  const date = getTodayDateString();
  const existingLog = await getTodayLogOrEmpty(userId);
  const lists = await getTrackingLists(userId, existingLog);
  logEvent("Chat mode", { mode: normalizedMode, message: normalizedMessage });

  if (normalizedMode === "doctor") {
    const doctorReply = await buildDoctorModeReply(
      userId,
      normalizedMessage,
      conversationHistory,
      lists.supplementsList,
      "historical"
    );

    return {
      response: doctorReply.response,
      type: "question",
      loggedData: null,
      nextQuestion: null,
      recapDone: false,
      _openaiUsage: doctorReply._openaiUsage || []
    };
  }

  const classified = await classifyAndParse(
    normalizedMessage,
    existingLog,
    lists.supplementsList,
    lists.symptomsList,
    conversationHistory
  );
  logEvent("Chat classifier", classified);

  if (classified.type === "question" || classified.type === "meta") {
    const doctorReply = await buildDoctorModeReply(
      userId,
      normalizedMessage,
      conversationHistory,
      lists.supplementsList,
      classified.contextDepth || "recent"
    );

    if (normalizedMode === "recap") {
      return {
        response: doctorReply.response,
        type: classified.type,
        loggedData: null,
        nextQuestion: buildRecapQuestion(
          "continue-recap",
          existingLog,
          lists.supplementsList,
          lists.symptomsList
        ),
        recapDone: false,
        _openaiUsage: [
          ...(classified._openaiUsage || []),
          ...(doctorReply._openaiUsage || [])
        ]
      };
    }

    return {
      response: doctorReply.response,
      type: classified.type,
      loggedData: null,
      nextQuestion: null,
      recapDone: false,
      _openaiUsage: [
        ...(classified._openaiUsage || []),
        ...(doctorReply._openaiUsage || [])
      ]
    };
  }

  if (classified.type === "identity_update") {
    await appendToIdentitySection(
      userId,
      classified.data?.identitySection,
      classified.data?.identityAppend
    );

    const response = `Got it - added to your ${classified.data.identitySection}.`;

    if (normalizedMode === "recap") {
      return {
        response,
        type: classified.type,
        loggedData: null,
        nextQuestion: buildRecapQuestion(
          "continue-recap",
          existingLog,
          lists.supplementsList,
          lists.symptomsList
        ),
        recapDone: false,
        _openaiUsage: classified._openaiUsage || []
      };
    }

    return {
      response,
      type: classified.type,
      loggedData: null,
      nextQuestion: null,
      recapDone: false,
      _openaiUsage: classified._openaiUsage || []
    };
  }

  if (classified.data?.unrecognized) {
    return {
      response: classified.data.message,
      type: classified.type,
      loggedData: null,
      nextQuestion: normalizedMode === "recap" ? recapState.currentQuestion || null : null,
      recapDone: false,
      _openaiUsage: classified._openaiUsage || []
    };
  }

  const { storagePatch, loggedData, parsedNote, masterUpdates } = stripChatMeta(
    classified.data
  );
  await updateLog(userId, date, storagePatch);
  const nextLists = await syncMasterLists(userId, masterUpdates, lists);
  const updatedLog = (await getLog(userId, date)) || createEmptyDailyLog(date);

  if (normalizedMode === "recap") {
    const coveredFields = uniqueStrings([
      ...(Array.isArray(recapState.coveredFields) ? recapState.coveredFields : []),
      ...(Array.isArray(recapState?.currentQuestion?.fields)
        ? recapState.currentQuestion.fields
        : [])
    ]);
    const nextQuestion = getNextRecapQuestion(
      updatedLog,
      coveredFields,
      nextLists.supplementsList,
      nextLists.symptomsList
    );

    return {
      response: buildLogConfirmation(loggedData, parsedNote),
      type: classified.type,
      loggedData,
      nextQuestion: nextQuestion.done
        ? buildRecapQuestion(
            "wrap-up",
            updatedLog,
            nextLists.supplementsList,
            nextLists.symptomsList
          )
        : nextQuestion,
      recapDone: false,
      _openaiUsage: classified._openaiUsage || []
    };
  }

  return {
    response: buildLogConfirmation(loggedData, parsedNote),
    type: classified.type,
    loggedData,
    nextQuestion: null,
    recapDone: false,
    _openaiUsage: classified._openaiUsage || []
  };
}

function getTelegramSession(chatId) {
  const key = String(chatId);

  if (!telegramSessions.has(key)) {
    telegramSessions.set(key, {
      conversation: []
    });
  }

  return telegramSessions.get(key);
}

function appendTelegramConversation(session, role, content) {
  const normalized = String(content || "").trim();

  if (!normalized) {
    return;
  }

  session.conversation.push({ role, content: normalized });
  session.conversation = session.conversation.slice(-24);
}

async function startTelegramBridge() {
  startTelegramPolling({
    onMessage: async ({ chatId, text }) => {
      const userId = String(process.env.TELEGRAM_USER_ID || "").trim() || (await getCurrentUserId());
      const session = getTelegramSession(chatId);
      setSessionId(`telegram-${chatId}`);
      appendTelegramConversation(session, "user", text);

      try {
        const result = await processChatMessage({
          userId,
          mode: "free",
          message: text,
          conversationHistory: session.conversation,
          recapState: {}
        });

        appendTelegramConversation(session, "assistant", result.response);
        await appendToThread(userId, text, result.response, result.type);
        return result.response;
      } catch (error) {
        console.error("[Boris Telegram] Failed to process message", { chatId, error });
        return "Sorry, I'm having trouble connecting right now. Try again in a moment.";
      }
    }
  });
}

app.use((req, _res, next) => {
  logEvent(`${req.method} ${req.path}`);
  next();
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb", parameterLimit: 1000 }));
app.use("/assets", express.static(path.join(UI_DIR, "assets")));
app.use("/vendor/marked", express.static(path.join(ROOT_DIR, "node_modules", "marked", "lib")));

app.get("/", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      logEvent("Profile incomplete, redirecting to onboarding.");
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "index.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load dashboard.", error);
  }
});

app.get("/onboarding", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (await isProfileComplete(userId)) {
      logEvent("Profile already complete, redirecting to dashboard.");
      return res.redirect("/");
    }

    return res.sendFile(path.join(UI_DIR, "onboarding.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load onboarding.", error);
  }
});

app.get("/chat", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      logEvent("Profile incomplete, redirecting chat to onboarding.");
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "chat.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load chat.", error);
  }
});

app.get("/records", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "records.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load records.", error);
  }
});

app.get("/schedules", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "schedules.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load schedules.", error);
  }
});

app.get("/automations", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "automations.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load automations.", error);
  }
});

app.get("/trends", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "trends.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load trends.", error);
  }
});

app.get("/api/trends", async (req, res) => {
  const requestedDays = String(req.query?.days || "90").trim().toLowerCase();
  const allTime = requestedDays === "all";
  const days = allTime ? null : Number(requestedDays);

  if (!allTime && (!Number.isInteger(days) || days < 1 || days > 3650)) {
    return sendError(res, 400, "Days must be between 1 and 3650, or 'all'.");
  }

  try {
    const userId = await getCurrentUserId();
    const endDate = getTodayDateString();
    const startDate = allTime
      ? "1900-01-01"
      : addDaysToDateString(endDate, -(days - 1));
    const queryStartDate = allTime ? startDate : addDaysToDateString(startDate, -1);
    const logs = await getDateRange(userId, queryStartDate, endDate);
    return res.json(buildTrends(logs, { startDate, endDate, allTime }));
  } catch (error) {
    return sendCaughtError(res, "Unable to load trends.", error);
  }
});

app.get("/api/automations/status", (_req, res) => {
  return res.json({
    telegramConfigured: hasConfiguredTelegramDelivery(),
    timezone: APP_TIMEZONE
  });
});

app.get("/api/automations", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    return res.json({ automations: await getAutomations(userId) });
  } catch (error) {
    return sendCaughtError(res, "Unable to load automations.", error);
  }
});

app.post("/api/automations", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const automation = await createAutomation(userId, req.body || {});
    return res.status(201).json({ automation });
  } catch (error) {
    return sendCaughtError(res, "Unable to create automation.", error);
  }
});

app.put("/api/automations/:id", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const automation = await updateAutomation(userId, req.params.id, req.body || {});
    return res.json({ automation });
  } catch (error) {
    return sendCaughtError(res, "Unable to update automation.", error);
  }
});

app.delete("/api/automations/:id", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const deleted = await deleteAutomation(userId, req.params.id);
    if (!deleted) return sendError(res, 404, "Automation not found.");
    return res.json({ deleted: true });
  } catch (error) {
    return sendCaughtError(res, "Unable to delete automation.", error);
  }
});

app.get("/api/automations/:id/runs", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const runs = await getAutomationRuns(userId, req.params.id, req.query.limit);
    return res.json({ runs });
  } catch (error) {
    return sendCaughtError(res, "Unable to load automation history.", error);
  }
});

app.post("/api/automations/:id/run", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await runAutomationNow(
      userId,
      req.params.id,
      automationDependencies
    );
    return res.json({ result });
  } catch (error) {
    return sendCaughtError(res, "Unable to run automation.", error);
  }
});

app.get("/dev-logs", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!(await isProfileComplete(userId))) {
      return res.redirect("/onboarding");
    }

    return res.sendFile(path.join(UI_DIR, "dev-logs.html"));
  } catch (error) {
    return sendError(res, 500, "Unable to load dev logs.", error);
  }
});

app.get("/weather/today", async (_req, res) => {
  try {
    const weather = await getWeatherForDate(getTodayDateString());
    return res.json(weather);
  } catch (error) {
    return sendCaughtError(res, "Unable to load weather.", error);
  }
});

app.get("/notes", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    if (!wantsMarkdownResponse(_req)) {
      if (!(await isProfileComplete(userId))) {
        return res.redirect("/onboarding");
      }

      return res.sendFile(path.join(UI_DIR, "notes.html"));
    }

    const [healthPicture, healthPictureRecord] = await Promise.all([
      readHealthPicture(userId),
      getMemoryFileRecord(userId, "health-picture")
    ]);
    res.type("text/markdown");
    res.set("X-Last-Updated", healthPictureRecord?.updatedAt || new Date().toISOString());
    return res.send(healthPicture);
  } catch (error) {
    return sendError(res, 500, "Unable to load notes.", error);
  }
});

app.get("/identity", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const [identity, identityRecord] = await Promise.all([
      readIdentity(userId),
      getMemoryFileRecord(userId, "identity")
    ]);
    res.type("text/markdown");
    res.set("X-Last-Updated", identityRecord?.updatedAt || new Date().toISOString());
    return res.send(identity);
  } catch (error) {
    return sendError(res, 500, "Unable to read identity.", error);
  }
});

app.post("/identity/update", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const content = await updateIdentity(userId, req.body?.content);
    return res.json({
      message: "Identity updated.",
      content
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to update identity.", error);
  }
});

app.get("/health-picture", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const [healthPicture, healthPictureRecord] = await Promise.all([
      readHealthPicture(userId),
      getMemoryFileRecord(userId, "health-picture")
    ]);
    res.type("text/markdown");
    res.set("X-Last-Updated", healthPictureRecord?.updatedAt || new Date().toISOString());
    return res.send(healthPicture);
  } catch (error) {
    return sendError(res, 500, "Unable to read health picture.", error);
  }
});

app.post("/health-picture/note", async (req, res) => {
  const note = String(req.body?.note || "").trim();

  if (!note) {
    return sendError(res, 400, "The 'note' field is required.");
  }

  try {
    const userId = await getCurrentUserId();
    await appendHealthPictureNote(userId, note);
    const [healthPicture, healthPictureRecord] = await Promise.all([
      readHealthPicture(userId),
      getMemoryFileRecord(userId, "health-picture")
    ]);
    return res.status(201).json({
      message: "Manual note added.",
      healthPicture,
      lastUpdated: healthPictureRecord?.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to append the note.", error);
  }
});

app.post("/health-picture/update", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const content = await writeHealthPicture(userId, req.body?.content);
    const record = await getMemoryFileRecord(userId, "health-picture");
    return res.json({
      message: "Health picture updated.",
      content,
      lastUpdated: record?.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to update health picture.", error);
  }
});

app.post("/health-picture/regenerate", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const content = await regenerateHealthPicture(userId);
    return res.json({
      success: true,
      content
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to regenerate health picture.", error);
  }
});

app.get("/google/status", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const connection = await getGoogleConnection(userId);
    return res.json({
      connected: Boolean(connection),
      expiryDate: connection?.expiry_date || null,
      scope: connection?.scope || null
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to load Google connection status.", error);
  }
});

app.get("/auth/google", async (_req, res) => {
  try {
    const { url } = getGoogleAuthUrl();
    return res.redirect(url);
  } catch (error) {
    return sendCaughtError(res, "Unable to start Google connection.", error);
  }
});

app.get("/auth/google/callback", async (req, res) => {
  const code = String(req.query?.code || "").trim();
  const state = String(req.query?.state || "").trim();
  const callbackError = String(req.query?.error || "").trim();

  if (callbackError) {
    return res.redirect(`/schedules?google_error=${encodeURIComponent(callbackError)}`);
  }

  if (!code || !consumeAuthState(state)) {
    return res.redirect("/schedules?google_error=invalid_callback");
  }

  try {
    const userId = await getCurrentUserId();
    const tokens = await exchangeCodeForTokens(code);
    await upsertGoogleConnection(userId, tokens);
    await syncGoogleCalendar(userId);
    return res.redirect("/schedules?google_connected=1");
  } catch (error) {
    console.error("[Boris] Google callback failed", error);
    return res.redirect(`/schedules?google_error=${encodeURIComponent(error?.message || "connect_failed")}`);
  }
});

app.post("/google/disconnect", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    await deleteGoogleConnection(userId);
    await replaceCalendarEvents(userId, []);
    return res.json({
      message: "Google disconnected."
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to disconnect Google.", error);
  }
});

app.post("/google/sync/calendar", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const events = await syncGoogleCalendar(userId);
    return res.json({
      message: "Calendar synced.",
      count: events.length
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to sync Google Calendar.", error);
  }
});

app.get("/schedules/recurring", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const items = await getStoredRecurringSchedules(userId);
    return res.json(items);
  } catch (error) {
    return sendCaughtError(res, "Unable to load recurring schedules.", error);
  }
});

app.post("/schedules/recurring", async (req, res) => {
  const title = String(req.body?.title || "").trim();

  if (!title) {
    return sendError(res, 400, "A recurring schedule title is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const item = await createRecurringSchedule(userId, req.body);
    return res.status(201).json(item);
  } catch (error) {
    return sendCaughtError(res, "Unable to save recurring schedule.", error);
  }
});

app.put("/schedules/recurring/:id", async (req, res) => {
  const scheduleId = String(req.params?.id || "").trim();
  const title = String(req.body?.title || "").trim();

  if (!scheduleId) {
    return sendError(res, 400, "A schedule ID is required.");
  }

  if (!title) {
    return sendError(res, 400, "A recurring schedule title is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const item = await updateRecurringSchedule(userId, scheduleId, req.body);
    return res.json(item);
  } catch (error) {
    return sendCaughtError(res, "Unable to update recurring schedule.", error);
  }
});

app.delete("/schedules/recurring/:id", async (req, res) => {
  const scheduleId = String(req.params?.id || "").trim();

  if (!scheduleId) {
    return sendError(res, 400, "A schedule ID is required.");
  }

  try {
    const userId = await getCurrentUserId();
    await deleteRecurringSchedule(userId, scheduleId);
    return res.json({
      message: "Recurring schedule deleted."
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to delete recurring schedule.", error);
  }
});

app.get("/schedules/preferences", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const preferences = await getPlanningPreferences(userId);
    return res.json(preferences);
  } catch (error) {
    return sendCaughtError(res, "Unable to load planning preferences.", error);
  }
});

app.post("/schedules/preferences", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const preferences = await upsertPlanningPreferences(userId, req.body || {});
    return res.json(preferences);
  } catch (error) {
    return sendCaughtError(res, "Unable to save planning preferences.", error);
  }
});

app.get("/schedules/calendar", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const events = await getCalendarEvents(userId);
    return res.json(events);
  } catch (error) {
    return sendCaughtError(res, "Unable to load calendar events.", error);
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const profileComplete = await isProfileComplete(userId);
    return res.json({ profileComplete });
  } catch (error) {
    return sendError(res, 500, "Unable to determine onboarding status.", error);
  }
});

app.get("/api/tour/visited", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    return res.json({ visited: await getVisitedPages(userId) });
  } catch (error) {
    return sendCaughtError(res, "Unable to load tutorial progress.", error);
  }
});

app.post("/api/tour/visited", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const page = await markPageVisited(userId, req.body?.page);
    return res.json({ page, visited: true });
  } catch (error) {
    return sendCaughtError(res, "Unable to save tutorial progress.", error);
  }
});

app.post("/onboarding", async (req, res) => {
  const requiredFields = ["name", "birthday", "medicalContext", "goals"];
  const missingField = requireFields(req.body, requiredFields);

  if (missingField) {
    return sendError(res, 400, `Missing required field: ${missingField}.`);
  }

  try {
    const userId = await getCurrentUserId();
    const result = await writeOnboardingFiles(userId, req.body);
    const medications = Array.isArray(req.body?.medications) ? req.body.medications : [];
    const supplements = Array.isArray(req.body?.supplements) ? req.body.supplements : [];
    const symptoms = uniqueStrings(String(req.body?.symptoms || "").split(/\r?\n/));

    await Promise.all([
      ...medications
        .filter((item) => String(item?.name || "").trim())
        .map((item) => savePrescription(userId, {
          date: new Date().toISOString().slice(0, 10),
          source: "Onboarding",
          extractedData: { ...item, medicationName: item.name, active: true }
        })),
      ...supplements
        .filter((item) => String(item?.name || "").trim())
        .map((item) => saveSupplement(userId, {
          date: new Date().toISOString().slice(0, 10),
          source: "Onboarding",
          extractedData: { ...item, medicationName: item.name, active: true }
        })),
      saveUserList(userId, "symptoms", symptoms)
    ]);

    let healthPicture = result.healthPictureMarkdown;
    let healthPictureGenerated = false;

    try {
      const generatedHealthPicture = await generateInitialHealthPicture(
        req.body,
        result.identityMarkdown,
        result.onboardingSnapshotMarkdown,
        result.healthPictureMarkdown
      );
      healthPicture = await writeHealthPicture(userId, generatedHealthPicture.content);
      healthPictureGenerated = generatedHealthPicture.generated;
    } catch (error) {
      logEvent("Initial health picture generation failed; using the structured onboarding summary.", {
        message: error.message
      });
    }

    logEvent("Identity and health picture initialized from onboarding.", {
      healthPictureGenerated
    });
    let morningBriefAutomation = null;
    let morningBriefCreated = false;

    try {
      const morningBriefResult = await ensureDefaultMorningBrief(userId);
      morningBriefAutomation = morningBriefResult.automation;
      morningBriefCreated = morningBriefResult.created;
    } catch (error) {
      logEvent("Onboarding completed, but the default morning brief could not be created.", {
        message: error.message
      });
    }

    return res.status(201).json({
      message: "Onboarding complete.",
      identity: result.identityMarkdown,
      healthPicture,
      healthPictureGenerated,
      morningBriefAutomation,
      morningBriefCreated
    });
  } catch (error) {
    return sendError(res, 500, "Unable to save onboarding data.", error);
  }
});

app.get("/tracking/symptoms", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    let items = await getUserList(userId, "symptoms");

    if (!items.length) {
      const identity = await readIdentity(userId);
      const onboardingSymptoms = getSymptomsFromIdentity(identity);

      if (onboardingSymptoms.length) {
        await saveUserList(userId, "symptoms", onboardingSymptoms);
        items = onboardingSymptoms;
      }
    }

    return res.json({ items });
  } catch (error) {
    return sendCaughtError(res, "Unable to load the symptom tracker.", error);
  }
});

app.put("/tracking/symptoms", async (req, res) => {
  if (!Array.isArray(req.body?.items)) {
    return sendError(res, 400, "The 'items' field must be an array of symptom names.");
  }

  try {
    const userId = await getCurrentUserId();
    const items = uniqueStrings(req.body.items);
    await saveUserList(userId, "symptoms", items);
    return res.json({ items });
  } catch (error) {
    return sendCaughtError(res, "Unable to update the symptom tracker.", error);
  }
});

app.post("/notes/add", async (req, res) => {
  const note = String(req.body?.note || "").trim();

  if (!note) {
    return sendError(res, 400, "The 'note' field is required.");
  }

  try {
    const userId = await getCurrentUserId();
    await appendHealthPictureNote(userId, note);
    const [healthPicture, healthPictureRecord] = await Promise.all([
      readHealthPicture(userId),
      getMemoryFileRecord(userId, "health-picture")
    ]);
    return res.status(201).json({
      message: "Note added.",
      notes: healthPicture,
      lastUpdated: healthPictureRecord?.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to append the note.", error);
  }
});

app.get("/summaries/list", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const summaries = await readSummaryList(userId);
    return res.json(summaries);
  } catch (error) {
    return sendCaughtError(res, "Unable to list summaries.", error);
  }
});

app.get("/summaries/:type/:filename", async (req, res) => {
  const { type, filename } = req.params;

  try {
    const userId = await getCurrentUserId();
    const normalizedType = normalizeSummaryType(type);
    const period = String(filename || "").replace(/\.md$/i, "").trim();
    const summary = await getSummary(userId, normalizedType, period);

    if (!summary?.content) {
      return sendError(res, 404, "Summary not found.");
    }

    return res.json({
      type: normalizedType,
      fileName: `${period}.md`,
      period,
      content: summary.content,
      createdAt: summary.createdAt || null,
      editedManually: summary.editedManually === true
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to read the summary.", error);
  }
});

app.post("/summaries/:type/:filename/update", async (req, res) => {
  const { type, filename } = req.params;
  const content = String(req.body?.content || "").trim();

  if (!content) {
    return sendError(res, 400, "Summary content is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const normalizedType = normalizeSummaryType(type);
    const period = String(filename || "").replace(/\.md$/i, "").trim();
    const summary = await saveSummary(userId, normalizedType, period, content, {
      editedManually: true
    });

    return res.json({
      message: "Summary updated.",
      type: normalizedType,
      fileName: `${period}.md`,
      period,
      content: summary.content,
      createdAt: summary.createdAt || null,
      editedManually: summary.editedManually === true
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to update the summary.", error);
  }
});

app.get("/dev/logs/summary", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const summary = await getApiLogSummary(userId);
    return res.json(summary);
  } catch (error) {
    return sendCaughtError(res, "Unable to load API log summary.", error);
  }
});

app.get("/dev/logs/:id", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const item = await getApiLog(userId, req.params.id);

    if (!item) {
      return sendError(res, 404, "API log not found.");
    }

    return res.json(item);
  } catch (error) {
    return sendCaughtError(res, "Unable to load API log.", error);
  }
});

app.get("/dev/logs", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const logs = await getApiLogs(userId, {
      source: req.query?.source,
      model: req.query?.model,
      successOnly: parseBooleanQuery(req.query?.successOnly),
      errorsOnly: parseBooleanQuery(req.query?.errorsOnly),
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
      search: req.query?.search,
      limit: req.query?.limit,
      offset: req.query?.offset
    });
    return res.json(logs);
  } catch (error) {
    return sendCaughtError(res, "Unable to load API logs.", error);
  }
});

app.post("/dev/logs/truncate", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const truncatedCount = await truncateOldLogs(userId, req.body?.daysToKeep);
    return res.json({
      message: "API logs truncated.",
      truncatedCount
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to truncate API logs.", error);
  }
});

app.post("/estimate/macros", async (req, res) => {
  const description = String(req.body?.description || "").trim();

  if (!description) {
    return sendError(res, 400, "The 'description' field is required.");
  }

  try {
    logEvent("Estimating macros", { description });
    const estimate = await estimateMacros(description);
    const { _openaiUsage, ...payload } = estimate;
    return res.json(withOpenAIMeta(payload, _openaiUsage));
  } catch (error) {
    console.error("[Boris] Could not estimate macros", error);
    return res.status(502).json({
      error: "Could not estimate macros"
    });
  }
});

app.post("/records/extract", upload.single("file"), async (req, res) => {
  const file = req.file;
  const date = String(req.body?.date || "").trim();
  const source = String(req.body?.source || "").trim();
  const type = validateRecordType(req.body?.type);
  const documentText = String(req.body?.text || "").trim();

  if (type === "doctor_visit") {
    if (!file?.buffer?.length && !documentText) {
      return sendError(res, 400, "Upload a PDF or image, or paste the visit text.");
    }
  } else if (!file?.buffer?.length) {
    return sendError(res, 400, "Please choose a PDF or image file.");
  }

  if (!date || !isValidDateString(date)) {
    return sendError(res, 400, "A valid date is required. Use YYYY-MM-DD.");
  }

  if (type !== "supplement" && !source) {
    return sendError(res, 400, "A source is required.");
  }

  try {
    if (!["lab_results", "supplement", "doctor_visit"].includes(type)) {
      return sendError(
        res,
        400,
        "Document extraction is not available for that record type."
      );
    }

    let extractionResult;
    if (type === "lab_results") {
      extractionResult = await extractLabResults(
          file.buffer.toString("base64"),
          file.mimetype,
          date,
          source
        );
    } else if (type === "supplement") {
      extractionResult = await extractSupplementLabel(
          file.buffer.toString("base64"),
          file.mimetype
        );
    } else {
      const userId = await getCurrentUserId();
      const identity = await readIdentity(userId);
      extractionResult = await extractDoctorVisit({
        fileBase64: file?.buffer?.toString("base64") || null,
        mimeType: file?.mimetype || null,
        documentText,
        date,
        source,
        identity,
        fileName: file?.originalname || "Pasted visit text"
      });
    }
    const { _openaiUsage, ...payloadExtractionResult } = extractionResult;
    const resolvedSource =
      source ||
      payloadExtractionResult.practice ||
      payloadExtractionResult.provider ||
      payloadExtractionResult.brand ||
      payloadExtractionResult.medicationName ||
      "Supplement Label";
    const resolvedDate = type === "doctor_visit" &&
      isValidDateString(payloadExtractionResult.visitDate)
      ? payloadExtractionResult.visitDate
      : date;

    return res.json(withOpenAIMeta({
      type,
      date: resolvedDate,
      source: resolvedSource,
      fileName: file?.originalname || "Pasted visit text",
      extractionResult: payloadExtractionResult
    }, _openaiUsage));
  } catch (error) {
    return sendCaughtError(
      res,
      "Boris could not read that document. Try a clearer scan or image.",
      error
    );
  }
});

app.post("/records/save", async (req, res) => {
  const date = String(req.body?.date || "").trim();
  const source = String(req.body?.source || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const extractionResult = isPlainObject(req.body?.extractionResult)
    ? req.body.extractionResult
    : null;

  if (!date || !isValidDateString(date)) {
    return sendError(res, 400, "A valid record date is required.");
  }

  if (!source) {
    return sendError(res, 400, "A record source is required.");
  }

  if (!extractionResult) {
    return sendError(res, 400, "An extraction result is required.");
  }

  try {
    const type = validateRecordType(req.body?.type);
    if (
      type === "doctor_visit" &&
      !validateDoctorVisitSummary(extractionResult.summaryMarkdown)
    ) {
      return sendError(res, 400, "The doctor visit summary is missing one or more required sections.");
    }
    const userId = await getCurrentUserId();
    const payload = {
      date,
      source,
      notes,
      extractedData: extractionResult,
      rawText: extractionResult.rawText || null,
      flaggedCount: Number(extractionResult.flaggedCount) || 0,
      borderlineCount: Number(extractionResult.borderlineCount) || 0,
      normalCount: Number(extractionResult.normalCount) || 0
    };
    let record = null;

    if (type === "lab_results") {
      record = await saveLabResult(userId, payload);
    } else if (type === "prescription") {
      record = await savePrescription(userId, payload);
    } else if (type === "supplement") {
      record = await saveSupplement(userId, payload);
    } else if (type === "doctor_visit") {
      record = await saveDoctorVisit(userId, payload);
    } else {
      return sendError(res, 400, "That record type is not supported by Neon yet.");
    }

    const healthPictureUpdated = type === "lab_results"
      ? await refreshHealthPictureAfterLabChange(userId, "save")
      : type === "doctor_visit"
        ? await refreshHealthPictureAfterDoctorVisitChange(userId, "save")
        : null;

    return res.status(201).json({
      message: healthPictureUpdated === false
        ? `${type === "doctor_visit" ? "Doctor visit" : "Lab record"} saved. Health Picture could not refresh just now.`
        : type === "doctor_visit"
          ? "Doctor visit saved and Health Picture refreshed."
          : "Record saved.",
      record,
      healthPictureUpdated
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to save that record.", error);
  }
});

app.get("/records/detail/:recordId", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const record = await getRecordById(userId, req.params.recordId, req.query?.type || null);

    if (!record) {
      return sendError(res, 404, "Record not found.");
    }

    return res.json(record);
  } catch (error) {
    return sendCaughtError(res, "Unable to read that record.", error);
  }
});

app.get("/records/:type", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const records = await getRecordsByType(userId, req.params.type);
    return res.json(records);
  } catch (error) {
    return sendCaughtError(res, "Unable to read records.", error);
  }
});

app.get("/supplements/active", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const records = await getActiveSupplements(userId).catch(() => []);
    return res.json(mapActiveMedicationRecords(records));
  } catch (error) {
    return sendCaughtError(res, "Unable to load active supplements.", error);
  }
});

app.get("/prescriptions/active", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const records = await getActivePrescriptions(userId).catch(() => []);
    return res.json(mapActiveMedicationRecords(records));
  } catch (error) {
    return sendCaughtError(res, "Unable to load active prescriptions.", error);
  }
});

app.get("/api/active-supplements", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const records = await getActiveSupplements(userId).catch(() => []);
    return res.json(mapActiveMedicationRecords(records));
  } catch (error) {
    return sendCaughtError(res, "Unable to load active supplements.", error);
  }
});

app.get("/api/active-prescriptions", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const records = await getActivePrescriptions(userId).catch(() => []);
    return res.json(mapActiveMedicationRecords(records));
  } catch (error) {
    return sendCaughtError(res, "Unable to load active prescriptions.", error);
  }
});

app.get("/supplements/nutrients/:name", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const rollup = await getNutrientRollup(userId, req.params.name);
    return res.json(rollup);
  } catch (error) {
    return sendCaughtError(res, "Unable to load nutrient rollup.", error);
  }
});

app.put("/records/:recordId", async (req, res) => {
  const date = String(req.body?.date || "").trim();
  const source = String(req.body?.source || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const extractionResult = isPlainObject(req.body?.extractionResult)
    ? req.body.extractionResult
    : null;

  if (!date || !isValidDateString(date)) {
    return sendError(res, 400, "A valid record date is required.");
  }

  if (!source) {
    return sendError(res, 400, "A record source is required.");
  }

  if (!extractionResult) {
    return sendError(res, 400, "An extraction result is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const existingRecord = await getRecordById(userId, req.params.recordId, req.body?.type || null);

    if (!existingRecord) {
      return sendError(res, 404, "Record not found.");
    }

    if (
      existingRecord.type === "doctor_visit" &&
      !validateDoctorVisitSummary(extractionResult.summaryMarkdown)
    ) {
      return sendError(res, 400, "The doctor visit summary is missing one or more required sections.");
    }

    const payload = {
      date,
      source,
      notes,
      extractedData: extractionResult,
      rawText: extractionResult.rawText || existingRecord.rawText || null,
      flaggedCount: Number(extractionResult.flaggedCount) || 0,
      borderlineCount: Number(extractionResult.borderlineCount) || 0,
      normalCount: Number(extractionResult.normalCount) || 0
    };
    let record = null;

    if (existingRecord.type === "lab_results") {
      record = await updateLabResult(userId, req.params.recordId, payload);
    } else if (existingRecord.type === "prescription") {
      record = await updatePrescription(userId, req.params.recordId, payload);
    } else if (existingRecord.type === "supplement") {
      record = await updateSupplement(userId, req.params.recordId, payload);
    } else if (existingRecord.type === "doctor_visit") {
      record = await updateDoctorVisit(userId, req.params.recordId, payload);
    } else {
      return sendError(res, 400, "That record type cannot be updated here.");
    }

    const healthPictureUpdated = existingRecord.type === "lab_results"
      ? await refreshHealthPictureAfterLabChange(userId, "update")
      : existingRecord.type === "doctor_visit"
        ? await refreshHealthPictureAfterDoctorVisitChange(userId, "update")
        : null;

    return res.json({
      message: healthPictureUpdated === false
        ? `${existingRecord.type === "doctor_visit" ? "Doctor visit" : "Lab record"} updated. Health Picture could not refresh just now.`
        : "Record updated.",
      record,
      healthPictureUpdated
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to update that record.", error);
  }
});

app.delete("/records/:recordId", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const deleted = await deleteRecordById(userId, req.params.recordId, req.query?.type || null);

    if (!deleted) {
      return sendError(res, 404, "Record not found.");
    }

    const healthPictureUpdated = deleted.type === "lab_results"
      ? await refreshHealthPictureAfterLabChange(userId, "deletion")
      : deleted.type === "doctor_visit"
        ? await refreshHealthPictureAfterDoctorVisitChange(userId, "deletion")
        : null;

    return res.json({
      message: healthPictureUpdated === false
        ? `${deleted.type === "doctor_visit" ? "Doctor visit" : "Lab record"} deleted. Health Picture could not refresh just now.`
        : "Record deleted.",
      healthPictureUpdated
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to delete that record.", error);
  }
});

app.post("/chat", async (req, res) => {
  const mode = String(req.body?.mode || "free").trim().toLowerCase();
  const message = String(req.body?.message || "").trim();
  const conversationHistory = Array.isArray(req.body?.conversation)
    ? req.body.conversation
    : [];
  const recapState = isPlainObject(req.body?.recapState) ? req.body.recapState : {};

  if (!["free", "recap", "doctor"].includes(mode)) {
    return sendError(res, 400, "Invalid chat mode.");
  }

  if (!message) {
    return sendError(res, 400, "The 'message' field is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const result = await processChatMessage({
      userId,
      mode,
      message,
      conversationHistory,
      recapState
    });
    const shouldSendToTelegram = messageRequestsTelegramSend(message);
    let telegramStatus = null;

    if (shouldSendToTelegram && String(result.response || "").trim()) {
      try {
        await sendTelegramMessage(result.response);
        telegramStatus = "sent";
      } catch (error) {
        console.error("[Boris] Failed to send chat response to Telegram", error);
        telegramStatus = "failed";
      }
    }

    await appendToThread(userId, message, result.response, result.type);
    const { _openaiUsage, ...payload } = result;
    const responsePayload = withOpenAIMeta(
      telegramStatus
        ? {
            ...payload,
            response:
              telegramStatus === "sent"
                ? `${payload.response}\n\nSent to your Telegram.`
                : `${payload.response}\n\nI tried to send that to your Telegram, but the send failed.`
          }
        : payload,
      _openaiUsage
    );
    return res.json(responsePayload);
  } catch (error) {
    return sendCaughtError(
      res,
      "Sorry, I'm having trouble connecting right now. Try again in a moment.",
      error
    );
  }
});

app.post("/chat/endsession", async (req, res) => {
  setSessionId(null);
  return res.status(200).json({ ok: true });
});

app.post("/recap/start", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const existingLog = await getTodayLogOrEmpty(userId);
    const lists = await getTrackingLists(userId, existingLog);
    const firstQuestion = startDailyRecap(
      existingLog,
      lists.supplementsList,
      lists.symptomsList
    );
    const nextQuestion = firstQuestion.done
      ? buildRecapQuestion(
          "wrap-up",
          existingLog,
          lists.supplementsList,
          lists.symptomsList
        )
      : firstQuestion;

    return res.json({
      response:
        "Let's recap your day. I'll ask about what's missing. Feel free to ask me anything at any time and I'll switch to doctor mode and come back.",
      nextQuestion,
      recapState: {
        active: true,
        coveredFields: [],
        startedAt: new Date().toISOString(),
        interrupted: false,
        currentQuestion: nextQuestion
      }
    });
  } catch (error) {
    return sendCaughtError(
      res,
      "Unable to start the daily recap.",
      error
    );
  }
});

app.post("/recap/next", async (req, res) => {
  const recapState = isPlainObject(req.body?.recapState) ? req.body.recapState : {};
  const lastAnswer = req.body?.lastAnswer;
  const currentQuestion = recapState.currentQuestion;

  if (!currentQuestion?.key) {
    return sendError(res, 400, "A current recap question is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const date = getTodayDateString();
    const existingLog = await getTodayLogOrEmpty(userId);
    const lists = await getTrackingLists(userId, existingLog);

    if (currentQuestion.key === "continue-recap") {
      const wantsToContinue = String(lastAnswer || "").toLowerCase() === "yes" || lastAnswer === true;
      const nextQuestion = wantsToContinue
        ? getNextRecapQuestion(
            existingLog,
            recapState.coveredFields,
            lists.supplementsList,
            lists.symptomsList
          )
        : null;

      return res.json({
        response: wantsToContinue
          ? "Okay. Let's keep going."
          : "No problem. We can pause the recap here.",
        type: "recap_answer",
        loggedData: null,
        nextQuestion: wantsToContinue
          ? nextQuestion.done
            ? buildRecapQuestion(
                "wrap-up",
                existingLog,
                lists.supplementsList,
                lists.symptomsList
              )
            : nextQuestion
          : null,
        recapDone: !wantsToContinue,
        nextMode: wantsToContinue ? "recap" : "free"
      });
    }

    if (currentQuestion.key === "wrap-up") {
      const hasQuestions = String(lastAnswer || "").toLowerCase() === "yes" || lastAnswer === true;

      return res.json({
        response: hasQuestions
          ? "Switching to Doctor Mode. Ask me anything."
          : "Great. Your daily summary will be generated at 3am. Take care!",
        type: "recap_answer",
        loggedData: null,
        nextQuestion: null,
        recapDone: true,
        nextMode: hasQuestions ? "doctor" : "free"
      });
    }

    const answerResult = buildPatchFromStructuredAnswer(
      currentQuestion,
      lastAnswer,
      existingLog,
      lists.supplementsList,
      lists.symptomsList
    );
    const { storagePatch, masterUpdates } = stripChatMeta(answerResult.patch || {});

    if (Object.keys(storagePatch).length) {
      await updateLog(userId, date, storagePatch);
    }

    const nextLists = await syncMasterLists(userId, masterUpdates, lists);
    const updatedLog =
      (await getLog(userId, date)) || createEmptyDailyLog(date);
    const coveredFields = uniqueStrings([
      ...(Array.isArray(recapState.coveredFields) ? recapState.coveredFields : []),
      ...(Array.isArray(currentQuestion.fields) ? currentQuestion.fields : [])
    ]);
    const nextQuestion = getNextRecapQuestion(
      updatedLog,
      coveredFields,
      nextLists.supplementsList,
      nextLists.symptomsList
    );

    return res.json({
      response:
        answerResult.emptyMessage ||
        buildLogConfirmation(answerResult.loggedData),
      type: "recap_answer",
      loggedData: answerResult.loggedData,
      nextQuestion: nextQuestion.done
        ? buildRecapQuestion(
            "wrap-up",
            updatedLog,
            nextLists.supplementsList,
            nextLists.symptomsList
          )
        : nextQuestion,
      recapDone: false,
      recapState: {
        active: true,
        coveredFields,
        startedAt: recapState.startedAt || new Date().toISOString(),
        interrupted: false,
        currentQuestion: nextQuestion.done
          ? buildRecapQuestion(
              "wrap-up",
              updatedLog,
              nextLists.supplementsList,
              nextLists.symptomsList
            )
          : nextQuestion
      }
    });
  } catch (error) {
    return sendCaughtError(
      res,
      "Unable to continue the daily recap.",
      error
    );
  }
});

app.post("/log/update", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const requestedDate = String(req.body?.date || "").trim();
    const date = requestedDate && isValidDateString(requestedDate)
      ? requestedDate
      : getTodayDateString();
    const patch = isPlainObject(req.body?.patch) ? req.body.patch : req.body;
    const updatedLog = await updateLog(userId, date, patch);
    logEvent(`Updated daily log for ${date}.`);
    return res.json(updatedLog);
  } catch (error) {
    return sendCaughtError(res, "Unable to update that log.", error);
  }
});

app.post("/parse", async (req, res) => {
  const message = String(req.body?.message || "").trim();

  if (!message) {
    return sendError(res, 400, "The 'message' field is required.");
  }

  try {
    const userId = await getCurrentUserId();
    const date = getTodayDateString();
    const existingLog =
      (await getLog(userId, date)) || createEmptyDailyLog(date);
    const parsedResult = await parseHealthInput(message, existingLog);

    if (parsedResult.unrecognized) {
      const { _openaiUsage, ...payload } = parsedResult;
      return res.json(withOpenAIMeta(payload, _openaiUsage));
    }

    const { _parsed, _logged, _openaiUsage, ...storagePatch } = parsedResult;
    await updateLog(userId, date, storagePatch);

    return res.json(withOpenAIMeta({
      ...storagePatch,
      _parsed,
      _logged
    }, _openaiUsage));
  } catch (error) {
    return sendCaughtError(res, "Unable to parse the Tell Boris message.", error);
  }
});

app.get("/log/today", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const date = getTodayDateString();
    const log = await getLog(userId, date);

    if (!log) {
      return sendError(res, 404, `No log found for ${date}.`);
    }

    return res.json(log);
  } catch (error) {
    return sendCaughtError(res, "Unable to read today's log.", error);
  }
});

app.get("/log/range/:startDate/:endDate", async (req, res) => {
  const { startDate, endDate } = req.params;

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");
  }

  try {
    const userId = await getCurrentUserId();
    const logs = await getDateRange(userId, startDate, endDate);
    return res.json(logs);
  } catch (error) {
    return sendCaughtError(res, "Unable to read logs for the requested range.", error);
  }
});

app.get("/log/averages/:yearMonth", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getMonthlyAverages(userId, req.params.yearMonth);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to calculate monthly averages.", error);
  }
});

app.get("/log/flaredays/:yearMonth", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getFlareDays(userId, req.params.yearMonth);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to read flare days.", error);
  }
});

app.get("/log/gooddays/:yearMonth", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getGoodDays(userId, req.params.yearMonth);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to read good days.", error);
  }
});

app.get("/log/supplement/:name", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getSupplementHistory(userId, req.params.name);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to read supplement history.", error);
  }
});

app.get("/log/bestdays/:n", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getBestDays(userId, req.params.n);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to read best days.", error);
  }
});

app.get("/log/worstdays/:n", async (req, res) => {
  try {
    const userId = await getCurrentUserId();
    const result = await getWorstDays(userId, req.params.n);
    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to read worst days.", error);
  }
});

app.post("/log/compare", async (req, res) => {
  const {
    period1Start,
    period1End,
    period2Start,
    period2End
  } = req.body || {};

  if (
    !isValidDateString(period1Start) ||
    !isValidDateString(period1End) ||
    !isValidDateString(period2Start) ||
    !isValidDateString(period2End)
  ) {
    return sendError(res, 400, "Invalid compare payload. Use YYYY-MM-DD dates.");
  }

  try {
    const userId = await getCurrentUserId();
    const result = await comparePeriods(
      userId,
      period1Start,
      period1End,
      period2Start,
      period2End
    );

    return res.json(result);
  } catch (error) {
    return sendCaughtError(res, "Unable to compare periods.", error);
  }
});

app.get("/log/:date", async (req, res) => {
  const { date } = req.params;

  if (!isValidDateString(date)) {
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");
  }

  try {
    const userId = await getCurrentUserId();
    const log = await getLog(userId, date);

    if (!log) {
      return sendError(res, 404, `No log found for ${date}.`);
    }

    return res.json(log);
  } catch (error) {
    return sendCaughtError(res, `Unable to read log for ${date}.`, error);
  }
});

// ---------------------------------------------------------------------------
// Thread routes
// ---------------------------------------------------------------------------

app.get("/thread/today", async (_req, res) => {
  try {
    const userId = await getCurrentUserId();
    const date = getTodayDateString();
    const content = await getThread(userId, date);

    if (!content) {
      return res.json({ date, content: null, message: "No conversation thread for today." });
    }

    return res.json({ date, content });
  } catch (error) {
    return sendCaughtError(res, "Unable to read today's thread.", error);
  }
});

app.get("/thread/:date", async (req, res) => {
  const { date } = req.params;

  if (!isValidDateString(date)) {
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");
  }

  try {
    const userId = await getCurrentUserId();
    const content = await getThread(userId, date);

    if (!content) {
      return res.json({ date, content: null, message: `No conversation thread for ${date}.` });
    }

    return res.json({ date, content });
  } catch (error) {
    return sendCaughtError(res, `Unable to read thread for ${date}.`, error);
  }
});

// ---------------------------------------------------------------------------
// Cron / manual summary trigger
// ---------------------------------------------------------------------------

app.post("/cron/rundaily", async (req, res) => {
  const date = String(req.body?.date || "").trim() || getTodayDateString();
  const overwrite = req.body?.overwrite === true;

  if (!isValidDateString(date)) {
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");
  }

  try {
    const userId = await getCurrentUserId();
    logEvent("Manual summary trigger", { userId, date, overwrite });
    const results = await runDailySummaryWithCompression(userId, date, overwrite);
    return res.json({ date, results });
  } catch (error) {
    return sendCaughtError(res, "Unable to generate summary.", error);
  }
});

app.post("/cron/runmorningbrief", async (req, res) => {
  const requestedDate = String(req.body?.date || "").trim();
  const date = requestedDate || getTodayDateString();

  if (!isValidDateString(date)) {
    return sendError(res, 400, "Invalid date format. Use YYYY-MM-DD.");
  }

  try {
    const userId = await getCurrentUserId();
    logEvent("Manual morning brief trigger", { userId, date });
    const result = await generateMorningBrief(userId, {
      date,
      sendTelegram: true
    });
    return res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    return sendCaughtError(res, "Unable to generate morning brief.", error);
  }
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    return sendError(res, 400, "Upload failed. Please try a smaller file.");
  }

  if (error) {
    return sendCaughtError(res, "Unexpected server error.", error);
  }

  return next();
});

app.use((req, res) => {
  return sendError(res, 404, `Route not found: ${req.method} ${req.path}`);
});

async function startServer() {
  try {
    await initSchema();
    logEvent("Neon schema initialized.");
  } catch (error) {
    console.error("[Boris] Failed to initialize Neon schema", error);
    process.exit(1);
  }

  app.listen(PORT, () => {
    const openAIClient = getOpenAIClient();
    logEvent(openAIClient ? "OpenAI client initialized." : "OPENAI_API_KEY not set; AI features remain disabled.");
    logEvent(`Server listening on http://localhost:${PORT}`);
    initScheduler();
    startAutomationRunner(automationDependencies);
    startTelegramBridge();
  });
}

startServer();
