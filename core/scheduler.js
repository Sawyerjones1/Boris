const cron = require("node-cron");

const { getOpenAIClient, createTrackedResponse, setApiContext } = require("./api");
const {
  APP_TIMEZONE,
  getAppDateString,
  getAppNow,
  getTimestamp,
  addDaysToDateString,
  formatDisplayDate
} = require("./time");
const {
  archiveHealthPicture,
  readIdentity,
  readHealthPicture,
  readOnboardingSnapshot,
  writeHealthPicture
} = require("./profile");
const { getActiveUser } = require("./db");
const {
  getLog,
  getDateRange,
  saveSummary,
  getSummary,
  listSummaries,
  getRecentSummaries,
  getThread,
  archiveThread,
  truncateOldLogs,
  getRecurringSchedules,
  getSupplements,
  getActiveSupplements,
  getPrescriptions,
  getActivePrescriptions,
  getLabResults,
  getDoctorVisits
} = require("./neon");
const { getCalendarEvents, getPlanningPreferences } = require("./schedules");
const { sendTelegramMessage } = require("./telegram");
const { numberOrNull } = require("./utils");

function hasTelegramOutboundConfig() {
  return (
    Boolean(String(process.env.TELEGRAM_BOT_TOKEN || "").trim()) &&
    Boolean(
      String(
        process.env.TELEGRAM_ALLOWED_CHAT_ID ||
        process.env.TELEGRAM_CHAT_ID ||
        ""
      ).trim()
    )
  );
}
const SUMMARY_MODEL = "gpt-4.1";
function log(tag, message, details) {
  if (details) {
    console.log(`[${tag}] ${message}`, details);
    return;
  }

  console.log(`[${tag}] ${message}`);
}

function getTodayDateString() {
  return getAppDateString();
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function createDateAnchor(dateString) {
  const match = String(dateString || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
}

function getWeekdayKeyForDate(dateString) {
  const anchor = createDateAnchor(dateString);

  if (!anchor) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "long"
  })
    .format(anchor)
    .toLowerCase();
}

function getDateStringFromTimestamp(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(parsed)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateAnchor(anchor) {
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}-${String(anchor.getUTCDate()).padStart(2, "0")}`;
}

function getMonthEndDate(year, month) {
  return formatDateAnchor(new Date(Date.UTC(year, month, 0, 12, 0, 0)));
}

function getIsoWeekPeriod(weekEnd) {
  const end = createDateAnchor(weekEnd);

  if (!end || end.getUTCDay() !== 0) {
    throw new Error("Weekly summaries must end on a Sunday.");
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  const thursday = new Date(start);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0));
  const weekOneStart = new Date(jan4);
  weekOneStart.setUTCDate(weekOneStart.getUTCDate() - ((weekOneStart.getUTCDay() || 7) - 1));
  const weekNumber = Math.round((start - weekOneStart) / (7 * 86400000)) + 1;

  return {
    weekLabel: `${isoYear}-W${String(weekNumber).padStart(2, "0")}`,
    weekStart: formatDateAnchor(start),
    weekEnd: formatDateAnchor(end)
  };
}

function parseIsoWeekPeriod(weekLabel) {
  const match = String(weekLabel || "").match(/^(\d{4})-W(\d{2})$/);

  if (!match) {
    return null;
  }

  const isoYear = Number(match[1]);
  const weekNumber = Number(match[2]);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4, 12, 0, 0));
  const weekOneStart = new Date(jan4);
  weekOneStart.setUTCDate(weekOneStart.getUTCDate() - ((weekOneStart.getUTCDay() || 7) - 1));
  const weekStart = new Date(weekOneStart);
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekNumber - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  return {
    weekLabel: String(weekLabel),
    weekStart: formatDateAnchor(weekStart),
    weekEnd: formatDateAnchor(weekEnd)
  };
}

function getIsoWeekLabelForDate(date) {
  const anchor = createDateAnchor(date);
  if (!anchor) throw new Error("Invalid date for ISO week label.");
  anchor.setUTCDate(anchor.getUTCDate() + (7 - (anchor.getUTCDay() || 7)));
  return getIsoWeekPeriod(formatDateAnchor(anchor)).weekLabel;
}

function getMonthPeriod(monthEnd) {
  const end = createDateAnchor(monthEnd);

  if (!end || formatDateAnchor(end) !== getMonthEndDate(end.getUTCFullYear(), end.getUTCMonth() + 1)) {
    throw new Error("Monthly summaries must end on the last day of a month.");
  }

  const year = end.getUTCFullYear();
  const month = end.getUTCMonth() + 1;
  return {
    monthKey: `${year}-${String(month).padStart(2, "0")}`,
    monthStart: `${year}-${String(month).padStart(2, "0")}-01`,
    monthEnd: formatDateAnchor(end)
  };
}

function getQuarterPeriod(quarterEnd) {
  const monthPeriod = getMonthPeriod(quarterEnd);
  const month = Number(monthPeriod.monthKey.slice(-2));

  if (![3, 6, 9, 12].includes(month)) {
    throw new Error("Quarterly summaries must end on March 31, June 30, September 30, or December 31.");
  }

  const year = monthPeriod.monthKey.slice(0, 4);
  const quarter = Math.ceil(month / 3);
  const startMonth = (quarter - 1) * 3 + 1;
  const months = Array.from({ length: 3 }, (_, index) =>
    `${year}-${String(startMonth + index).padStart(2, "0")}`
  );

  return {
    quarterLabel: `${year}-Q${quarter}`,
    quarterStart: `${months[0]}-01`,
    quarterEnd: monthPeriod.monthEnd,
    months
  };
}

function getYearPeriod(yearEnd) {
  const end = createDateAnchor(yearEnd);

  if (!end || end.getUTCMonth() !== 11 || end.getUTCDate() !== 31) {
    throw new Error("Yearly summaries must end on December 31.");
  }

  const year = String(end.getUTCFullYear());
  return {
    year,
    yearStart: `${year}-01-01`,
    yearEnd: formatDateAnchor(end)
  };
}

function getLatestCompletedWeekEnd(referenceDate = getAppDateString()) {
  const reference = createDateAnchor(referenceDate);
  if (!reference) throw new Error("Invalid reference date for weekly summary.");
  const daysSinceSunday = reference.getUTCDay() || 7;
  reference.setUTCDate(reference.getUTCDate() - daysSinceSunday);
  return formatDateAnchor(reference);
}

function getLatestCompletedMonthEnd(referenceDate = getAppDateString()) {
  const reference = createDateAnchor(referenceDate);
  if (!reference) throw new Error("Invalid reference date for monthly summary.");
  return getMonthEndDate(reference.getUTCFullYear(), reference.getUTCMonth());
}

function getLatestCompletedQuarterEnd(referenceDate = getAppDateString()) {
  const reference = createDateAnchor(referenceDate);
  if (!reference) throw new Error("Invalid reference date for quarterly summary.");
  const currentQuarterStartMonth = Math.floor(reference.getUTCMonth() / 3) * 3;
  return getMonthEndDate(reference.getUTCFullYear(), currentQuarterStartMonth);
}

function getLatestCompletedYearEnd(referenceDate = getAppDateString()) {
  const reference = createDateAnchor(referenceDate);
  if (!reference) throw new Error("Invalid reference date for yearly summary.");
  return `${reference.getUTCFullYear() - 1}-12-31`;
}

function createEmptyDailyLog(date) {
  return {
    date,
    lastUpdated: null,
    vitals: {
      sleep: { hours: null, quality: null },
      energy: { morning: null, evening: null },
      mood: null,
      stress: null,
      goodDay: null,
      hrv: null,
      restingHR: null
    },
    supplements: [],
    intake: {
      meals: [],
      caffeine: null,
      alcohol: null,
      water: null
    },
    exercise: [],
    symptoms: [],
    flareDay: false,
    whatChanged: null,
    journal: null,
    journalEntries: [],
    vitalsReadings: [],
    weather: null
  };
}

async function getSummaryEntries(userId, type, limit = Infinity) {
  const items = await listSummaries(userId, type);
  const selected = items.slice(0, limit);
  const records = [];

  for (const item of selected) {
    const summary = await getSummary(userId, type, item.period);

    if (summary?.content) {
      records.push({
        fileName: `${item.period}.md`,
        period: item.period,
        content: summary.content,
        createdAt: summary.createdAt || item.created_at || null
      });
    }
  }

  return records;
}


async function callSummaryLLM(instructions, payload, label) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error("OPENAI_API_KEY is not set. Cannot generate summaries.");
  }

  setApiContext("scheduler", "cron");

  const { response } = await createTrackedResponse(
    {
      model: SUMMARY_MODEL,
      instructions,
      input: JSON.stringify(payload, null, 2)
    },
    {
      label
    }
  );

  return String(response.output_text || "").trim();
}

const HEALTH_PICTURE_HEADINGS = [
  "# Current Supplement Stack",
  "# Active Patterns",
  "# Lab Picture",
  "# Current Concerns"
];

function hasValidHealthPictureStructure(content) {
  const headings = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#\s+/.test(line));

  return headings.length === HEALTH_PICTURE_HEADINGS.length &&
    headings.every((heading, index) => heading === HEALTH_PICTURE_HEADINGS[index]);
}

function collectMetricValues(logs, extractor) {
  const values = [];

  for (const logEntry of logs) {
    const val = extractor(logEntry);
    if (val !== null) {
      values.push(val);
    }
  }

  return values;
}

function averageOrNull(values) {
  if (!values.length) {
    return null;
  }

  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
  );
}

function buildWeeklyAverages(logs) {
  const metrics = {
    sleepHours: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.sleep?.hours)
    ),
    sleepQuality: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.sleep?.quality)
    ),
    energyMorning: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.energy?.morning)
    ),
    energyEvening: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.energy?.evening)
    ),
    mood: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.mood)
    ),
    stress: collectMetricValues(logs, (logEntry) =>
      numberOrNull(logEntry?.vitals?.stress)
    )
  };

  const averages = {};
  for (const [key, values] of Object.entries(metrics)) {
    averages[key] =
      values.length < 3
        ? {
            average: averageOrNull(values),
            daysWithData: values.length,
            insufficientData: true
          }
        : {
            average: averageOrNull(values),
            daysWithData: values.length
          };
  }

  return averages;
}

async function readThreadFile(userId, date) {
  return getThread(userId, date);
}

async function archiveThreadFile(userId, date) {
  try {
    await archiveThread(userId, date);
    log("Scheduler", `Archived thread for ${date}`);
  } catch (error) {
    log("Scheduler", `Failed to archive thread for ${date}`, error);
  }
}

const DAILY_SUMMARY_PROMPT = `You are generating a daily health insight for Boris, a personal health agent.

Write ONLY interpretations, connections, and clinical observations - NOT a recap of the data. The structured health log is stored separately in a database; do not restate sleep hours, supplement lists, meal descriptions, or exercise details.

Focus on:
- Why something happened (e.g., "HR spike likely driven by double stimulant dose on poor sleep")
- Connections between data points that aren't obvious from the raw numbers
- Deviations from the patient's normal patterns and what likely caused them
- Anything clinically noteworthy that the weekly summary should know about

If nothing notable happened today, say so in one sentence.

Keep the output to 2-4 sentences maximum. Use past tense. Write in clinical note style. Never invent data.`;

function appliesToWeekday(schedule, weekdayKey) {
  return Array.isArray(schedule?.daysOfWeek) && schedule.daysOfWeek.includes(weekdayKey);
}

function getTodayCalendarEvents(calendarEvents, date) {
  return (Array.isArray(calendarEvents) ? calendarEvents : [])
    .filter((event) => event?.includeMorningBrief !== false)
    .filter((event) => getDateStringFromTimestamp(event?.startTime) === date)
    .sort((left, right) =>
      String(left?.startTime || "").localeCompare(String(right?.startTime || ""))
    );
}

function mapMorningMedication(record) {
  const data = record?.extractedData || {};
  return {
    name: String(data.medicationName || "").trim() || null,
    dose: String(data.dose || "").trim() || null,
    frequency: String(data.frequency || "").trim() || null,
    timeOfDay: String(data.timeOfDay || "").trim() || null,
    purpose: String(data.purpose || "").trim() || null,
    notes: String(data.notes || record?.notes || "").trim() || null
  };
}

const MORNING_GUIDANCE_PROMPT = `You are Boris generating morning guidance for today.

Your job is NOT to create a rigid time-blocked schedule. Instead, tell the person how to approach the day based on health context, recent symptoms, sleep, yesterday's trend, obligations, and the near-term calendar.

Rules:
- Use only data provided. Never invent events, symptoms, or habits.
- If optional automation instructions are supplied, use them as a focus for the brief only when they are consistent with the provided health data.
- Keep total response under 220 words.
- Use second person ("you", "your").
- Be practical, grounded, and concise.
- Treat recurring schedules and calendar events as context for today's likely load, not as a timeline to reproduce.
- If work, class, or other commitments make the day higher-drain, say so plainly.
- If yesterday's sleep was under 6 hours, HRV was low, or it was a flare day, open with a short recovery-oriented line.
- Weave in supplement reminders only if timing matters for today. Do not create a separate supplement section.
- Timezone is ET.

Preferred structure:
Day type: one short line such as "Today looks like a light-output day."
Why: one sentence connecting yesterday's data to today's likely capacity.
Focus today:
- 2 to 3 short bullets
Watch out for:
- 1 short bullet
If energy improves:
- 1 short bullet

Do not format the message as hourly time blocks unless the data clearly requires calling out a single hard commitment.`;

async function generateMorningBrief(userId, options = {}) {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    throw new Error("A userId is required to generate the morning brief.");
  }

  const targetDate = String(options.date || "").trim() || getTodayDateString();

  if (!isValidDateString(targetDate)) {
    throw new Error("Invalid morning brief date. Use YYYY-MM-DD.");
  }

  const yesterday = addDaysToDateString(targetDate, -1);
  const weekdayKey = getWeekdayKeyForDate(targetDate);
  const displayDate = formatDisplayDate(targetDate, { includeWeekday: true });

  const [
    yesterdayLog,
    todayLog,
    yesterdaySummary,
    recurringSchedules,
    calendarEvents,
    activeSupplements,
    activePrescriptions,
    planningPreferences
  ] = await Promise.all([
    getLog(normalizedUserId, yesterday).catch(() => null),
    getLog(normalizedUserId, targetDate).catch(() => null),
    getSummary(normalizedUserId, "daily", yesterday).catch(() => null),
    getRecurringSchedules(normalizedUserId).catch(() => []),
    getCalendarEvents(normalizedUserId).catch(() => []),
    getActiveSupplements(normalizedUserId).catch(() => []),
    getActivePrescriptions(normalizedUserId).catch(() => []),
    getPlanningPreferences(normalizedUserId).catch(() => null)
  ]);

  const applicableRecurringSchedules = recurringSchedules.filter((schedule) =>
    appliesToWeekday(schedule, weekdayKey)
  );
  const todayCalendarEvents = getTodayCalendarEvents(calendarEvents, targetDate);
  const weather = todayLog?.weather || null;

  const message = await callSummaryLLM(
    MORNING_GUIDANCE_PROMPT,
    {
      date: targetDate,
      displayDate,
      dayOfWeek: weekdayKey,
      yesterdayLog,
      yesterdaySummary: String(yesterdaySummary?.content || "").trim() || null,
      weather,
      todayCalendarEvents,
      recurringSchedules: applicableRecurringSchedules,
      activeSupplements: activeSupplements.map(mapMorningMedication).filter((entry) => entry.name),
      activePrescriptions: activePrescriptions.map(mapMorningMedication).filter((entry) => entry.name),
      planningPreferences,
      automationInstructions: String(options.customInstructions || "").trim() || null
    },
    "generating morning brief"
  );

  let sent = false;

  if (options.sendTelegram === true) {
    if (!hasTelegramOutboundConfig()) {
      log("Morning Brief", "Telegram not configured. Skipping outbound send.");
    } else {
      try {
        await sendTelegramMessage(message);
        sent = true;
      } catch (error) {
        log("Morning Brief", "Telegram send failed", error);
      }
    }
  }

  return {
    date: targetDate,
    message,
    sent
  };
}

async function generateDailySummary(userId, date, isManual = false) {
  const existing = await getSummary(userId, "daily", date);

  if (existing?.content && !isManual) {
    log("Daily Summary", `Summary exists for ${date}, skipping`);
    return { skipped: true, reason: "exists" };
  }

  const [dayLog, threadContent] = await Promise.all([
    getLog(userId, date).catch(() => null),
    readThreadFile(userId, date)
  ]);

  const hasLog = dayLog && dayLog.lastUpdated;
  const hasThread = threadContent && threadContent.trim().length > 0;

  if (!hasLog && !hasThread) {
    log("Daily Summary", `No data for ${date}`);
    return { skipped: true, reason: "no_data" };
  }

  const payload = {
    date,
    displayDate: formatDisplayDate(date, { includeWeekday: true })
  };

  if (hasLog) {
    payload.dailyLog = dayLog;
  }

  if (hasThread) {
    payload.conversationThread = threadContent;
  }

  let prompt = DAILY_SUMMARY_PROMPT;
  if (!hasLog && hasThread) {
    prompt +=
      "\n\nNote: No structured health data was logged for this day. Generate a minimal insight that only captures anything clinically or behaviorally notable from the thread.";
  }

  const summaryText = await callSummaryLLM(
    prompt,
    payload,
    "generating daily summary"
  );

  await saveSummary(userId, "daily", date, summaryText);
  await archiveThreadFile(userId, date);

  const wordCount = summaryText.split(/\s+/).filter(Boolean).length;
  log("Daily Summary", `Generated for ${date}`, {
    wordCount,
    period: date
  });

  return { success: true, period: date, wordCount, summary: summaryText };
}

function dateInRange(date, start, end) {
  return String(date || "") >= start && String(date || "") <= end;
}

async function getWeeklyMedicalRecords(userId, weekStart, weekEnd) {
  const results = [];

  const loaders = [
    ["supplement", () => getSupplements(userId)],
    ["prescription", () => getPrescriptions(userId)],
    ["lab_results", () => getLabResults(userId)],
    ["doctor_visit", () => getDoctorVisits(userId)]
  ];

  for (const [type, load] of loaders) {
    try {
      const records = await load();
      results.push(...records.filter((record) => dateInRange(record?.date, weekStart, weekEnd)));
    } catch (error) {
      log("Weekly Summary", `Failed to read ${type} records for health picture regeneration`, error);
    }
  }

  return results.sort((left, right) =>
    String(right?.date || "").localeCompare(String(left?.date || ""))
  );
}

function isRecordActive(record) {
  return record?.extractedData?.active !== false;
}

function mapMedicationContext(record, options = {}) {
  const includeTimeOfDay = options.includeTimeOfDay === true;
  const context = {
    name: String(record?.extractedData?.medicationName || "").trim() || null,
    dose: String(record?.extractedData?.dose || "").trim() || null,
    frequency: String(record?.extractedData?.frequency || "").trim() || null,
    purpose: String(record?.extractedData?.purpose || "").trim() || null,
    notes: String(record?.extractedData?.notes || record?.notes || "").trim() || null
  };

  if (includeTimeOfDay) {
    context.timeOfDay =
      String(record?.extractedData?.timeOfDay || "").trim() || null;
  }

  return context;
}

function summarizeNewRecord(record) {
  if (record?.type === "lab_results") {
    const flaggedValues = Array.isArray(record?.extractedData?.values)
      ? record.extractedData.values.filter((value) => {
          const flag = String(value?.flag || "normal").toLowerCase();
          return flag !== "normal";
        }).length
      : 0;

    return `${flaggedValues} flagged values`;
  }

  if (record?.type === "doctor_visit") {
    return (
      String(record?.extractedData?.summaryMarkdown || "").trim() ||
      String(record?.notes || "").trim() ||
      "No visit summary"
    );
  }

  return (
    String(record?.extractedData?.notes || record?.notes || "").trim() ||
    "No details"
  );
}

async function getHealthPictureRecordContext(userId) {
  const [
    supplementRecords,
    activeSupplementRecords,
    prescriptionRecords,
    activePrescriptionRecords,
    labRecords,
    doctorVisitRecords
  ] = await Promise.all([
    getSupplements(userId).catch((error) => {
      log("Weekly Summary", "Failed to read supplement records for health picture regeneration", error);
      return [];
    }),
    getActiveSupplements(userId).catch((error) => {
      log("Weekly Summary", "Failed to read active supplement records for health picture regeneration", error);
      return [];
    }),
    getPrescriptions(userId).catch((error) => {
      log("Weekly Summary", "Failed to read prescription records for health picture regeneration", error);
      return [];
    }),
    getActivePrescriptions(userId).catch((error) => {
      log("Weekly Summary", "Failed to read active prescription records for health picture regeneration", error);
      return [];
    }),
    getLabResults(userId).catch((error) => {
      log("Weekly Summary", "Failed to read lab records for health picture regeneration", error);
      return [];
    }),
    getDoctorVisits(userId).catch((error) => {
      log("Weekly Summary", "Failed to read doctor visit records for health picture regeneration", error);
      return [];
    })
  ]);

  const allRecords = [
    ...supplementRecords,
    ...prescriptionRecords,
    ...labRecords,
    ...doctorVisitRecords
  ];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    activeSupplements: activeSupplementRecords.filter(isRecordActive),
    activePrescriptions: activePrescriptionRecords.filter(isRecordActive),
    recentlyChangedRecords: allRecords
      .filter((record) => {
        const changedAt = record?.updatedAt || record?.createdAt;
        return changedAt && changedAt >= oneWeekAgo;
      })
      .sort((left, right) =>
        String(right?.updatedAt || right?.createdAt || "").localeCompare(
          String(left?.updatedAt || left?.createdAt || "")
        )
      )
  };
}

async function regenerateHealthPictureWithContext({
  userId,
  weekLabel,
  weekStart,
  weekEnd,
  dailySummaries,
  logs,
  weeklySummaryText
}) {
  const [identity, onboardingSnapshot, currentHealthPicture, medicalRecords, recordContext] = await Promise.all([
    readIdentity(userId),
    readOnboardingSnapshot(userId),
    readHealthPicture(userId),
    getWeeklyMedicalRecords(userId, weekStart, weekEnd),
    getHealthPictureRecordContext(userId)
  ]);

  const instructions = `You are regenerating health-picture.md for Boris, a personal health agent. Rewrite the document as a concise current-state memory file for the person whose data is provided.

Rules:
- Maintain exactly these 4 top-level sections in this order:
  1. # Current Supplement Stack
  2. # Active Patterns
  3. # Lab Picture
  4. # Current Concerns
- Stay under roughly 1,500 tokens.
- Incorporate useful new observations from dated daily insights, structured logs, and medical records.
- You are also provided with the full list of active supplements and prescriptions from the database, and medical records recently added or edited. A record's clinical date is its date field; its storage time does not make the visit or recommendation current.
- Drop stale or low-value details that are no longer relevant.
- Check for manually appended notes at the bottom of the current health picture. If any manual notes are still relevant, fold them into the appropriate section. Do not silently drop relevant manual notes.
- Write crisp bullets, not long paragraphs.
- Treat Identity, the onboarding snapshot, structured records, dated logs, and medical records as source evidence. Treat the current health picture as a prior synthesis, not independent proof of a claim.
- Do not invent data or strengthen the user's wording. Preserve uncertainty in reported diagnoses and concerns; for example, do not turn a reported reactivation or evaluation into a chronic or confirmed diagnosis.
- Never infer a medication or supplement purpose from common use. Include a purpose only when it appears in the supplied source data.
- Missing logs mean insufficient data. They do not prove that a dose, meal, activity, substance, symptom, or behavior did not occur.
- State adherence only when the dated logs contain enough explicit entries to support it. Never write "no missed doses" merely because no missed dose was recorded.
- State that a treatment was added, removed, started, or stopped only when a dated source explicitly records that change. The current active list alone does not establish "no changes this week."
- Describe a correlation only when multiple dated observations support it. Never state causation from timing alone. Label a person's submitted hunch as a user-reported factor to monitor, not an established pattern.
- If the supplied period has little or no meaningful new evidence, preserve source-grounded current context and say that there is insufficient new data to update patterns. Do not fill space with negative findings.
- This is a current health picture, not a historical archive. Keep only what Boris should actively remember now.
- For the "# Current Supplement Stack" section:
  - Treat activeSupplements and activePrescriptions as the exclusive source of truth for this section.
  - List exactly the active items supplied by those two database arrays. Do not add, remove, rename, or change an item's dose or schedule based on Identity, onboarding, the prior health picture, daily prose, or a doctor visit document.
  - A treatment listed or recommended in a doctor visit is historical clinical context until the structured medication or supplement database confirms it is active.
  - Do not place pending recommendations, possible future changes, inactive treatments, adherence commentary, or detailed ingredient panels in this section.
  - Include dose, frequency, and purpose when available.
  - Group prescriptions separately from supplements with clear labels.
- For the "# Lab Picture" section:
  - If new lab results were uploaded this week, update this section with the new findings.
  - Keep existing lab context for values that were not re-tested.
- For the "# Current Concerns" section:
  - If a doctor visit was uploaded, incorporate clinically relevant findings and recommendations using the visit date from the record.
  - Label recommended or discussed treatments as pending unless the active treatment arrays confirm them.
  - Never describe the upload date as the visit date.
- For the "# Active Patterns" section:
  - Cross-reference this week's patterns with supplement and medication adherence when relevant.`;

  const nextHealthPicture = await callSummaryLLM(
    instructions,
    {
      weekLabel,
      weekStart,
      weekEnd,
      identity,
      onboardingSnapshot,
      currentHealthPicture,
      weeklySummary: weeklySummaryText,
      dailyInsights: dailySummaries.map((summary) => ({
        date: summary.fileName.replace(".md", ""),
        content: summary.content
      })),
      structuredLogs: logs,
      activeSupplements: recordContext.activeSupplements.map((record) =>
        mapMedicationContext(record)
      ),
      activePrescriptions: recordContext.activePrescriptions.map((record) =>
        mapMedicationContext(record, { includeTimeOfDay: true })
      ),
      recentlyChangedRecords: recordContext.recentlyChangedRecords.map((record) => ({
        type: record.type,
        clinicalDate: record.date,
        changedAt: record.updatedAt || record.createdAt,
        source: record.source,
        notes: record.notes,
        summary: summarizeNewRecord(record)
      })),
      medicalRecords: medicalRecords.map((record) => ({
        type: record.type,
        date: record.date,
        source: record.source,
        notes: record.notes,
        flaggedCount: record.flaggedCount,
        borderlineCount: record.borderlineCount,
        extractedData: record.extractedData
      }))
    },
    "regenerating health picture"
  );

  if (!hasValidHealthPictureStructure(nextHealthPicture)) {
    throw new Error("The regenerated health picture did not use the required four-section format.");
  }

  await archiveHealthPicture(userId, weekLabel);
  await writeHealthPicture(userId, nextHealthPicture);
  log("Weekly Summary", "Regenerated health picture", {
    userId,
    weekLabel
  });
}

async function regenerateHealthPicture(userId, options = {}) {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    throw new Error("A userId is required to regenerate the health picture.");
  }

  const now = getAppNow();
  const today = options.weekEnd || now.date;
  const weekLabel = options.weekLabel || getIsoWeekLabelForDate(today);
  const weekStart = options.weekStart || addDaysToDateString(today, -6);
  const dailySummaries =
    Array.isArray(options.dailySummaries) && options.dailySummaries.length
      ? options.dailySummaries
      : await getSummaryEntries(normalizedUserId, "daily", 7);
  const logs =
    Array.isArray(options.logs) && options.logs.length
      ? options.logs
      : await getDateRange(normalizedUserId, weekStart, today).catch(() => []);
  let weeklySummaryText = String(options.weeklySummaryText || "").trim();

  if (!weeklySummaryText) {
    const latestWeekly = await getSummary(normalizedUserId, "weekly", weekLabel).catch(
      () => null
    );
    weeklySummaryText = String(latestWeekly?.content || "").trim();
  }

  await regenerateHealthPictureWithContext({
    userId: normalizedUserId,
    weekLabel,
    weekStart,
    weekEnd: today,
    dailySummaries,
    logs,
    weeklySummaryText
  });

  return readHealthPicture(normalizedUserId);
}

async function generateWeeklySummary(userId, options = {}) {
  const period = getIsoWeekPeriod(
    String(options.weekEnd || "").trim() || getLatestCompletedWeekEnd()
  );
  const dailySummaries = (await getSummaryEntries(userId, "daily"))
    .filter((summary) => summary.period >= period.weekStart && summary.period <= period.weekEnd);

  if (!dailySummaries.length) {
    log("Weekly Summary", "No daily summaries found, skipping");
    return { skipped: true, reason: "no_daily_summaries" };
  }

  const logs = await getDateRange(userId, period.weekStart, period.weekEnd).catch(() => []);
  const recordContext = await getHealthPictureRecordContext(userId);
  const averages = buildWeeklyAverages(logs);

  const instructions = `You are generating a weekly health summary for Boris, a personal health agent. Create a comprehensive weekly summary that includes:

1. Overview: Days logged out of 7, general trend of the week.
2. Averages: For each metric provided, report the average and how many days had data. If fewer than 3 days have data for a field, note "insufficient data" rather than showing a potentially misleading average.
3. Symptoms: Most consistent symptoms across the week.
4. Supplements and Medications: Taken consistently vs missed. Only evaluate adherence for items in the active supplement and prescription lists provided. Do not flag missing items that are not currently active.
5. Exercise: Sessions count and types logged.
6. Notable patterns or changes across the week.
7. Any flare days and what they had in common.

Write in warm clinical note style. Be concise but complete. Never invent data.`;

  const summaryText = await callSummaryLLM(
    instructions,
    {
      weekLabel: period.weekLabel,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd,
      dailySummaries: dailySummaries.map((summary) => ({
        date: summary.fileName.replace(".md", ""),
        content: summary.content
      })),
      weeklyAverages: averages,
      daysLogged: logs.length,
      activeSupplements: recordContext.activeSupplements.map((record) =>
        mapMedicationContext(record)
      ),
      activePrescriptions: recordContext.activePrescriptions.map((record) =>
        mapMedicationContext(record, { includeTimeOfDay: true })
      ),
      logs: logs.map((entry) => ({
        date: entry.date,
        vitals: entry.vitals,
        supplements: entry.supplements,
        exercise: entry.exercise,
        symptoms: entry.symptoms,
        flareDay: entry.flareDay,
        whatChanged: entry.whatChanged
      }))
    },
    "generating weekly summary"
  );

  await saveSummary(userId, "weekly", period.weekLabel, summaryText);
  await regenerateHealthPicture(userId, {
    userId,
    weekLabel: period.weekLabel,
    weekStart: period.weekStart,
    weekEnd: period.weekEnd,
    dailySummaries,
    logs,
    weeklySummaryText: summaryText
  });

  const wordCount = summaryText.split(/\s+/).filter(Boolean).length;
  log("Weekly Summary", `Generated ${period.weekLabel}`, { wordCount });

  return { success: true, period: period.weekLabel, wordCount };
}

async function generateMonthlySummary(userId, options = {}) {
  const period = getMonthPeriod(
    String(options.monthEnd || "").trim() || getLatestCompletedMonthEnd()
  );
  const weeklySummaries = await getSummaryEntries(userId, "weekly");
  const relevantWeeklies = weeklySummaries.filter((summary) => {
    const week = parseIsoWeekPeriod(summary.period);
    return week && week.weekStart >= period.monthStart && week.weekEnd <= period.monthEnd;
  });
  const dailySummaries = await getSummaryEntries(userId, "daily");
  const monthDailies = dailySummaries.filter((summary) =>
    summary.period >= period.monthStart && summary.period <= period.monthEnd
  );

  if (!relevantWeeklies.length && !monthDailies.length) {
    log("Monthly Summary", "No summaries found for current month, skipping");
    return { skipped: true, reason: "no_summaries" };
  }

  const instructions = `You are generating a monthly health summary for Boris, a personal health agent. Create a monthly summary that includes:

1. Monthly averages and how they compared to the prior period.
2. Trend observations - what improved, what declined, what stayed stable.
3. Notable events, pattern changes, or health decisions made this month.
4. Supplement and exercise consistency.
5. Symptom frequency and any new patterns.

Write in warm clinical note style. Be concise but complete. Never invent data.`;

  const summaryText = await callSummaryLLM(
    instructions,
    {
      monthKey: period.monthKey,
      monthStart: period.monthStart,
      monthEnd: period.monthEnd,
      monthLabel: formatDisplayDate(period.monthStart, { includeDay: false }),
      weeklySummaries: relevantWeeklies.map((summary) => ({
        label: summary.fileName.replace(".md", ""),
        content: summary.content
      })),
      dailySummaryCount: monthDailies.length,
      dailyHighlights: monthDailies.slice(0, 10).map((summary) => ({
        date: summary.fileName.replace(".md", ""),
        content: summary.content
      }))
    },
    "generating monthly summary"
  );

  await saveSummary(userId, "monthly", period.monthKey, summaryText);

  const wordCount = summaryText.split(/\s+/).filter(Boolean).length;
  log("Monthly Summary", `Generated ${period.monthKey}`, { wordCount });

  return { success: true, period: period.monthKey, wordCount };
}

async function generateQuarterlySummary(userId, options = {}) {
  const period = getQuarterPeriod(
    String(options.quarterEnd || "").trim() || getLatestCompletedQuarterEnd()
  );
  const monthlySummaries = await getSummaryEntries(userId, "monthly");
  const relevantMonthlies = monthlySummaries.filter((summary) =>
    period.months.includes(summary.period)
  );

  if (!relevantMonthlies.length) {
    log("Quarterly Summary", "No monthly summaries found for current quarter, skipping");
    return { skipped: true, reason: "no_monthly_summaries" };
  }

  const instructions = `You are generating a quarterly health summary for Boris, a personal health agent. Create a quarterly summary that includes:

1. Quarter-over-quarter observations.
2. Key health trends over the three-month period.
3. Notable changes in symptoms, energy, sleep patterns.
4. Supplement and exercise consistency trends.
5. Significant health decisions or events.
6. Recommendations or areas to watch going forward.

Write in warm clinical note style. Be concise but complete. Never invent data.`;

  const summaryText = await callSummaryLLM(
    instructions,
    {
      quarterLabel: period.quarterLabel,
      quarterStart: period.quarterStart,
      quarterEnd: period.quarterEnd,
      months: period.months,
      monthlySummaries: relevantMonthlies.map((summary) => ({
        month: summary.fileName.replace(".md", ""),
        content: summary.content
      }))
    },
    "generating quarterly summary"
  );

  await saveSummary(userId, "quarterly", period.quarterLabel, summaryText);

  const wordCount = summaryText.split(/\s+/).filter(Boolean).length;
  log("Quarterly Summary", `Generated ${period.quarterLabel}`, { wordCount });

  return { success: true, period: period.quarterLabel, wordCount };
}

async function generateYearlySummary(userId, options = {}) {
  const period = getYearPeriod(
    String(options.yearEnd || "").trim() || getLatestCompletedYearEnd()
  );
  const quarterlySummaries = await getSummaryEntries(userId, "quarterly");
  const relevantQuarterlies = quarterlySummaries.filter((summary) =>
    summary.period.startsWith(`${period.year}-Q`)
  );

  if (!relevantQuarterlies.length) {
    log("Yearly Summary", "No quarterly summaries found for current year, skipping");
    return { skipped: true, reason: "no_quarterly_summaries" };
  }

  const instructions = `You are generating a yearly health summary for Boris, a personal health agent. Create a comprehensive yearly summary that includes:

1. Year in review - overall health trajectory.
2. Quarter-by-quarter progression.
3. Key milestones, breakthroughs, or setbacks.
4. Longest streaks and most consistent habits.
5. Areas of most improvement and areas still needing attention.
6. Summary of health decisions made throughout the year.

Write in warm clinical note style. Be comprehensive but not repetitive. Never invent data.`;

  const summaryText = await callSummaryLLM(
    instructions,
    {
      year: period.year,
      yearStart: period.yearStart,
      yearEnd: period.yearEnd,
      quarterlySummaries: relevantQuarterlies.map((summary) => ({
        quarter: summary.fileName.replace(".md", ""),
        content: summary.content
      }))
    },
    "generating yearly summary"
  );

  await saveSummary(userId, "yearly", period.year, summaryText);

  const wordCount = summaryText.split(/\s+/).filter(Boolean).length;
  log("Yearly Summary", `Generated ${period.year}`, { wordCount });

  return { success: true, period: period.year, wordCount };
}

async function readRecentSummaries(userId) {
  const [dailyPeriods, weeklyPeriods, monthlyPeriods, quarterlyPeriods] = await Promise.all([
    listSummaries(userId, "daily"),
    listSummaries(userId, "weekly"),
    listSummaries(userId, "monthly"),
    listSummaries(userId, "quarterly")
  ]);

  const [dailyContents, weeklyContents, monthlyContents, quarterlyContents] = await Promise.all([
    getRecentSummaries(userId, "daily", 7),
    getRecentSummaries(userId, "weekly", 4),
    getRecentSummaries(userId, "monthly", 3),
    getRecentSummaries(userId, "quarterly", Math.max(quarterlyPeriods.length, 1))
  ]);

  const attach = (periods, contents) =>
    contents.map((content, index) => ({
      fileName: `${periods[index]?.period || "unknown"}.md`,
      content
    }));

  return {
    dailies: attach(dailyPeriods, dailyContents),
    weeklies: attach(weeklyPeriods, weeklyContents),
    monthlies: attach(monthlyPeriods, monthlyContents),
    quarterlies: attach(quarterlyPeriods, quarterlyContents)
  };
}

async function runDailySummaryWithCompression(userId, date, overwrite = false) {
  const results = {};
  results.daily = await generateDailySummary(userId, date, overwrite);

  const anchor = createDateAnchor(date);
  if (!anchor) {
    throw new Error("Invalid summary date. Use YYYY-MM-DD.");
  }

  if (anchor.getUTCDay() === 0) {
    try {
      results.weekly = await generateWeeklySummary(userId, { weekEnd: date });
    } catch (error) {
      log("Scheduler", "Weekly summary failed during manual trigger", error);
      results.weekly = { skipped: true, reason: "error", error: error.message };
    }
  }

  if (formatDateAnchor(anchor) === getMonthEndDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1)) {
    try {
      results.monthly = await generateMonthlySummary(userId, { monthEnd: date });
    } catch (error) {
      log("Scheduler", "Monthly summary failed during manual trigger", error);
      results.monthly = { skipped: true, reason: "error", error: error.message };
    }
  }

  if ([3, 6, 9, 12].includes(anchor.getUTCMonth() + 1) &&
      formatDateAnchor(anchor) === getMonthEndDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1)) {
    try {
      results.quarterly = await generateQuarterlySummary(userId, { quarterEnd: date });
    } catch (error) {
      log("Scheduler", "Quarterly summary failed during manual trigger", error);
      results.quarterly = { skipped: true, reason: "error", error: error.message };
    }
  }

  if (anchor.getUTCMonth() === 11 && anchor.getUTCDate() === 31) {
    try {
      results.yearly = await generateYearlySummary(userId, { yearEnd: date });
    } catch (error) {
      log("Scheduler", "Yearly summary failed during manual trigger", error);
      results.yearly = { skipped: true, reason: "error", error: error.message };
    }
  }

  return results;
}

function initScheduler() {
  log("Scheduler", "Initializing cron jobs");

  cron.schedule(
    "0 3 * * *",
    async () => {
      try {
        log("Scheduler", "Daily summary cron job started");
        const userId = await getActiveUser();
        const yesterday = addDaysToDateString(getAppDateString(), -1);
        const result = await generateDailySummary(userId, yesterday, false);
        log("Scheduler", "Daily summary cron job completed", result);
      } catch (error) {
        log("Scheduler", "Daily summary cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  cron.schedule(
    "30 3 * * 1",
    async () => {
      try {
        log("Scheduler", "Weekly summary cron job started");
        const userId = await getActiveUser();
        const result = await generateWeeklySummary(userId, {
          weekEnd: addDaysToDateString(getAppDateString(), -1)
        });
        log("Scheduler", "Weekly summary cron job completed", result);
      } catch (error) {
        log("Scheduler", "Weekly summary cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  cron.schedule(
    "0 4 1 * *",
    async () => {
      try {
        log("Scheduler", "Monthly summary cron job started");
        const userId = await getActiveUser();
        const result = await generateMonthlySummary(userId, {
          monthEnd: addDaysToDateString(getAppDateString(), -1)
        });
        log("Scheduler", "Monthly summary cron job completed", result);
      } catch (error) {
        log("Scheduler", "Monthly summary cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  cron.schedule(
    "30 4 1 1,4,7,10 *",
    async () => {
      try {
        log("Scheduler", "Quarterly summary cron job started");
        const userId = await getActiveUser();
        const result = await generateQuarterlySummary(userId, {
          quarterEnd: addDaysToDateString(getAppDateString(), -1)
        });
        log("Scheduler", "Quarterly summary cron job completed", result);
      } catch (error) {
        log("Scheduler", "Quarterly summary cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  cron.schedule(
    "0 5 1 1 *",
    async () => {
      try {
        log("Scheduler", "Yearly summary cron job started");
        const userId = await getActiveUser();
        const result = await generateYearlySummary(userId, {
          yearEnd: addDaysToDateString(getAppDateString(), -1)
        });
        log("Scheduler", "Yearly summary cron job completed", result);
      } catch (error) {
        log("Scheduler", "Yearly summary cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  cron.schedule(
    "0 4 * * 1",
    async () => {
      try {
        log("Scheduler", "Dev log truncation cron job started");
        const userId = await getActiveUser();
        const truncatedCount = await truncateOldLogs(userId, 30);
        log("Scheduler", "Dev log truncation cron job completed", {
          truncatedCount
        });
      } catch (error) {
        log("Scheduler", "Dev log truncation cron job failed", error);
      }
    },
    { timezone: APP_TIMEZONE }
  );

  log("Scheduler", "All cron jobs registered");
}

module.exports = {
  createEmptyDailyLog,
  getIsoWeekPeriod,
  getMonthPeriod,
  getQuarterPeriod,
  getYearPeriod,
  getLatestCompletedWeekEnd,
  getLatestCompletedMonthEnd,
  getLatestCompletedQuarterEnd,
  getLatestCompletedYearEnd,
  getTodayDateString,
  getTimestamp,
  isValidDateString,
  generateDailySummary,
  generateWeeklySummary,
  generateMonthlySummary,
  generateQuarterlySummary,
  generateYearlySummary,
  generateMorningBrief,
  regenerateHealthPicture,
  runDailySummaryWithCompression,
  readRecentSummaries,
  readThreadFile,
  initScheduler
};
