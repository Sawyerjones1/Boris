const { pool } = require("./neon");
const { APP_TIMEZONE } = require("./time");

const AUTOMATION_TYPES = new Set(["reminder", "morning_brief"]);
const SCHEDULE_TYPES = new Set(["once", "multiple", "recurring"]);
const DAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
];
const DEFAULT_MORNING_BRIEF_NAME = "Daily Morning Brief";
const DEFAULT_MORNING_BRIEF_TIME = "09:00";

function createError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function textOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isValidDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function normalizeTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    : null;
}

function validateTimeZone(value) {
  const timeZone = String(value || APP_TIMEZONE).trim() || APP_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch (_error) {
    throw createError("Choose a valid IANA timezone.");
  }
}

function getZonedParts(input, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(input).filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    date: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function zonedDateTimeToUtc(dateString, timeString, timeZone) {
  if (!isValidDate(dateString)) return null;
  const time = normalizeTime(timeString);
  if (!time) return null;
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desiredUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second
    );
    candidate -= representedUtc - desiredUtc;
  }

  const confirmed = getZonedParts(new Date(candidate), timeZone);
  if (
    confirmed.year !== year || confirmed.month !== month || confirmed.day !== day ||
    confirmed.hour !== hour || confirmed.minute !== minute
  ) {
    return null;
  }

  return new Date(candidate);
}

function addLocalDays(dateString, count) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + count, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function getDayKey(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return DAY_KEYS[new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()];
}

function normalizeOccurrences(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      date: isValidDate(item?.date) ? String(item.date) : null,
      time: normalizeTime(item?.time)
    }))
    .filter((item) => item.date && item.time)
    .filter((item) => {
      const key = `${item.date}T${item.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`));
}

function normalizeAutomationInput(data = {}) {
  const type = String(data.type || "reminder").trim().toLowerCase();
  const scheduleType = String(data.scheduleType || "once").trim().toLowerCase();
  const name = String(data.name || "").trim();
  const message = textOrNull(data.message);
  const instructions = textOrNull(data.instructions);
  const timezone = validateTimeZone(data.timezone);

  if (!AUTOMATION_TYPES.has(type)) throw createError("Choose a supported automation type.");
  if (!SCHEDULE_TYPES.has(scheduleType)) throw createError("Choose a supported schedule type.");
  if (!name) throw createError("An automation name is required.");
  if (type === "reminder" && !message) throw createError("Reminder text is required.");

  const occurrences = normalizeOccurrences(data.occurrences);
  const daysOfWeek = [...new Set((Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [])
    .map((day) => String(day || "").trim().toLowerCase())
    .filter((day) => DAY_KEYS.includes(day)))];
  const timesOfDay = [...new Set((Array.isArray(data.timesOfDay) ? data.timesOfDay : [])
    .map(normalizeTime).filter(Boolean))].sort();
  const startDate = isValidDate(data.startDate) ? String(data.startDate) : null;
  const endDate = isValidDate(data.endDate) ? String(data.endDate) : null;

  if (scheduleType === "once" && occurrences.length !== 1) {
    throw createError("A one-time automation needs one date and time.");
  }
  if (scheduleType === "multiple" && !occurrences.length) {
    throw createError("Add at least one date and time.");
  }
  if (scheduleType === "recurring" && (!daysOfWeek.length || !timesOfDay.length)) {
    throw createError("A recurring automation needs at least one day and time.");
  }
  if (startDate && endDate && endDate < startDate) {
    throw createError("The end date cannot be before the start date.");
  }

  return {
    type,
    name,
    message,
    instructions,
    channel: "telegram",
    scheduleType,
    occurrences: scheduleType === "once" ? occurrences.slice(0, 1) : occurrences,
    daysOfWeek,
    timesOfDay,
    startDate,
    endDate,
    timezone,
    enabled: data.enabled !== false
  };
}

function calculateNextRun(automation, after = new Date()) {
  const safeAfter = after instanceof Date ? after : new Date(after);
  const timeZone = validateTimeZone(automation?.timezone);

  if (automation?.scheduleType === "once" || automation?.scheduleType === "multiple") {
    const candidates = normalizeOccurrences(automation?.occurrences)
      .map((item) => zonedDateTimeToUtc(item.date, item.time, timeZone))
      .filter((date) => date && date.getTime() > safeAfter.getTime())
      .sort((left, right) => left - right);
    return candidates[0]?.toISOString() || null;
  }

  if (automation?.scheduleType !== "recurring") return null;
  const localToday = getZonedParts(safeAfter, timeZone).date;
  const startDate = automation.startDate && automation.startDate > localToday
    ? automation.startDate
    : localToday;
  const days = new Set(automation.daysOfWeek || []);
  const times = (automation.timesOfDay || []).map(normalizeTime).filter(Boolean).sort();

  for (let offset = 0; offset <= 370; offset += 1) {
    const date = addLocalDays(startDate, offset);
    if (automation.endDate && date > automation.endDate) return null;
    if (!days.has(getDayKey(date))) continue;
    for (const time of times) {
      const candidate = zonedDateTimeToUtc(date, time, timeZone);
      if (candidate && candidate.getTime() > safeAfter.getTime()) {
        return candidate.toISOString();
      }
    }
  }

  return null;
}

function rowToAutomation(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    name: row.name,
    message: row.message,
    instructions: row.instructions,
    channel: row.channel,
    scheduleType: row.schedule_type,
    occurrences: Array.isArray(row.occurrences) ? row.occurrences : [],
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week : [],
    timesOfDay: Array.isArray(row.times_of_day) ? row.times_of_day : [],
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    timezone: row.timezone,
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

async function getAutomations(userId) {
  const result = await pool.query(
    "SELECT * FROM automations WHERE user_id = $1 ORDER BY enabled DESC, next_run_at ASC NULLS LAST, created_at DESC",
    [userId]
  );
  return result.rows.map(rowToAutomation);
}

async function getAutomation(userId, id) {
  const result = await pool.query(
    "SELECT * FROM automations WHERE user_id = $1 AND id = $2 LIMIT 1",
    [userId, id]
  );
  return rowToAutomation(result.rows[0]);
}

async function createAutomation(userId, data) {
  const item = normalizeAutomationInput(data);
  const nextRunAt = item.enabled ? calculateNextRun(item) : null;
  if (item.enabled && !nextRunAt) throw createError("This automation has no future run time.");
  const result = await pool.query(
    `INSERT INTO automations (
      user_id, type, name, message, instructions, channel, schedule_type,
      occurrences, days_of_week, times_of_day, start_date, end_date, timezone,
      enabled, next_run_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *`,
    [userId, item.type, item.name, item.message, item.instructions, item.channel,
      item.scheduleType, JSON.stringify(item.occurrences), item.daysOfWeek,
      item.timesOfDay, item.startDate, item.endDate, item.timezone, item.enabled,
      nextRunAt]
  );
  return rowToAutomation(result.rows[0]);
}

function buildDefaultMorningBriefAutomation() {
  return {
    type: "morning_brief",
    name: DEFAULT_MORNING_BRIEF_NAME,
    message: null,
    instructions: "Create a concise, useful morning brief grounded in my logged sleep, symptoms, recent patterns, schedule, and active treatments. Lead with my likely capacity for the day, give two or three practical priorities, flag the most relevant risk or constraint, and do not invent details when data is missing.",
    scheduleType: "recurring",
    occurrences: [],
    daysOfWeek: [...DAY_KEYS],
    timesOfDay: [DEFAULT_MORNING_BRIEF_TIME],
    startDate: null,
    endDate: null,
    timezone: APP_TIMEZONE,
    enabled: true
  };
}

async function ensureDefaultMorningBrief(userId) {
  const items = await getAutomations(userId);
  const existing = items.find((item) =>
    item.type === "morning_brief" &&
    item.scheduleType === "recurring" &&
    item.timesOfDay.includes(DEFAULT_MORNING_BRIEF_TIME) &&
    DAY_KEYS.every((day) => item.daysOfWeek.includes(day))
  );

  if (existing) return { automation: existing, created: false };
  return {
    automation: await createAutomation(userId, buildDefaultMorningBriefAutomation()),
    created: true
  };
}

async function updateAutomation(userId, id, data) {
  const existing = await getAutomation(userId, id);
  if (!existing) throw createError("Automation not found.", 404);
  const item = normalizeAutomationInput({ ...existing, ...data });
  const nextRunAt = item.enabled ? calculateNextRun(item) : null;
  if (item.enabled && !nextRunAt) throw createError("This automation has no future run time.");
  const enabled = item.enabled;
  const result = await pool.query(
    `UPDATE automations SET
      type=$3, name=$4, message=$5, instructions=$6, channel=$7,
      schedule_type=$8, occurrences=$9::jsonb, days_of_week=$10,
      times_of_day=$11, start_date=$12, end_date=$13, timezone=$14,
      enabled=$15, next_run_at=$16, updated_at=now()
     WHERE user_id=$1 AND id=$2 RETURNING *`,
    [userId, id, item.type, item.name, item.message, item.instructions,
      item.channel, item.scheduleType, JSON.stringify(item.occurrences),
      item.daysOfWeek, item.timesOfDay, item.startDate, item.endDate,
      item.timezone, enabled, nextRunAt]
  );
  return rowToAutomation(result.rows[0]);
}

async function deleteAutomation(userId, id) {
  const result = await pool.query(
    "DELETE FROM automations WHERE user_id = $1 AND id = $2 RETURNING id",
    [userId, id]
  );
  return Boolean(result.rowCount);
}

async function getAutomationRuns(userId, automationId, limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const result = await pool.query(
    `SELECT id, automation_id, scheduled_for, started_at, completed_at, status,
            message_text, error_message
     FROM automation_runs
     WHERE user_id = $1 AND automation_id = $2
     ORDER BY scheduled_for DESC LIMIT $3`,
    [userId, automationId, safeLimit]
  );
  return result.rows.map((row) => ({
    id: row.id,
    automationId: row.automation_id,
    scheduledFor: new Date(row.scheduled_for).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    status: row.status,
    messageText: row.message_text,
    errorMessage: row.error_message
  }));
}

async function claimDueAutomations(limit = 20) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT * FROM automations
       WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= now()
       ORDER BY next_run_at ASC
       FOR UPDATE SKIP LOCKED LIMIT $1`,
      [limit]
    );
    const claimed = [];

    for (const row of due.rows) {
      const automation = rowToAutomation(row);
      const scheduledFor = automation.nextRunAt;
      const run = await client.query(
        `INSERT INTO automation_runs (automation_id, user_id, scheduled_for, status, started_at)
         VALUES ($1,$2,$3,'running',now())
         ON CONFLICT (automation_id, scheduled_for) DO NOTHING
         RETURNING id`,
        [automation.id, automation.userId, scheduledFor]
      );
      const nextRunAt = calculateNextRun(automation, new Date(new Date(scheduledFor).getTime() + 1000));
      await client.query(
        `UPDATE automations SET next_run_at=$2, enabled=$3, updated_at=now()
         WHERE id=$1`,
        [automation.id, nextRunAt, Boolean(nextRunAt)]
      );
      if (run.rows[0]) claimed.push({ automation, runId: run.rows[0].id, scheduledFor });
    }

    await client.query("COMMIT");
    return claimed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeRun(claim, status, messageText, errorMessage = null) {
  await Promise.all([
    pool.query(
      `UPDATE automation_runs SET status=$2, message_text=$3, error_message=$4,
              completed_at=now() WHERE id=$1`,
      [claim.runId, status, textOrNull(messageText), textOrNull(errorMessage)]
    ),
    pool.query(
      `UPDATE automations SET last_run_at=now(), last_status=$2, last_error=$3,
              updated_at=now() WHERE id=$1`,
      [claim.automation.id, status, textOrNull(errorMessage)]
    )
  ]);
}

async function executeClaim(claim, dependencies) {
  try {
    let message = claim.automation.message;
    if (claim.automation.type === "morning_brief") {
      const result = await dependencies.generateMorningBrief(claim.automation.userId, {
        sendTelegram: false,
        customInstructions: claim.automation.instructions || null
      });
      message = result.message;
    }
    await dependencies.sendTelegramMessage(message);
    await completeRun(claim, "sent", message);
    return { automationId: claim.automation.id, status: "sent", message };
  } catch (error) {
    await completeRun(claim, "failed", null, error.message || "Automation failed.");
    return { automationId: claim.automation.id, status: "failed", error: error.message };
  }
}

async function runDueAutomations(dependencies) {
  const claims = await claimDueAutomations();
  const results = [];
  for (const claim of claims) results.push(await executeClaim(claim, dependencies));
  return results;
}

async function runAutomationNow(userId, id, dependencies) {
  const automation = await getAutomation(userId, id);
  if (!automation) throw createError("Automation not found.", 404);
  const run = await pool.query(
    `INSERT INTO automation_runs (automation_id, user_id, scheduled_for, status, started_at)
     VALUES ($1,$2,now(),'running',now()) RETURNING id, scheduled_for`,
    [id, userId]
  );
  return executeClaim({
    automation,
    runId: run.rows[0].id,
    scheduledFor: new Date(run.rows[0].scheduled_for).toISOString()
  }, dependencies);
}

function startAutomationRunner(dependencies, intervalMs = 30000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueAutomations(dependencies);
    } catch (error) {
      console.error("[Boris Automations] Runner failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}

function formatAutomationSchedule(automation) {
  const formatTime = (value) => {
    const [hourValue, minute = "00"] = String(value || "").split(":");
    const hour = Number(hourValue);
    if (!Number.isFinite(hour)) return String(value || "");
    return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
  };
  const formatOccurrence = (item) => `${item.date} at ${formatTime(item.time)}`;

  if (automation.scheduleType === "once") {
    return formatOccurrence(automation.occurrences[0]);
  }
  if (automation.scheduleType === "multiple") {
    return automation.occurrences.map(formatOccurrence).join(", ");
  }

  const dayLabels = {
    sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
    thursday: "Thu", friday: "Fri", saturday: "Sat"
  };
  const days = automation.daysOfWeek.map((day) => dayLabels[day] || day).join(", ");
  const times = automation.timesOfDay.map(formatTime).join(", ");
  return `${days} at ${times}`;
}

module.exports = {
  normalizeAutomationInput,
  calculateNextRun,
  zonedDateTimeToUtc,
  getAutomations,
  getAutomation,
  createAutomation,
  buildDefaultMorningBriefAutomation,
  ensureDefaultMorningBrief,
  updateAutomation,
  deleteAutomation,
  getAutomationRuns,
  runDueAutomations,
  runAutomationNow,
  startAutomationRunner,
  formatAutomationSchedule
};
