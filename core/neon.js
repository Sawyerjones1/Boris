require("dotenv").config();

const { Pool } = require("pg");
const { isPlainObject, numberOrNull } = require("./utils");

function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function logNeon(operation, details) {
  if (details) {
    console.log(`[Neon] ${operation}`, details);
    return;
  }

  console.log(`[Neon] ${operation}`);
}

function logDevLogs(operation, details) {
  if (details) {
    console.log(`[Dev Logs] ${operation}`, details);
    return;
  }

  console.log(`[Dev Logs] ${operation}`);
}

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

if (!DATABASE_URL) {
  throw createError("Missing required DATABASE_URL configuration for Neon Postgres.", 500);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function textOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function boolOrDefault(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function dateOnlyOrNull(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function timestampOrNow(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return new Date().toISOString();
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeSupplementIngredients(ingredients) {
  return arrayOrEmpty(ingredients)
    .map((ingredient) => ({
      name: textOrNull(ingredient?.name),
      amount: textOrNull(ingredient?.amount),
      unit: textOrNull(ingredient?.unit),
      dailyValuePercent: textOrNull(
        ingredient?.dailyValuePercent ?? ingredient?.daily_value_pct
      )
    }))
    .filter((ingredient) => ingredient.name);
}


function mergeDeep(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source;
  }

  const merged = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      merged[key] = mergeDeep(target[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function resolvePayload(data) {
  const extractedData =
    data?.extractedData && typeof data.extractedData === "object" && !Array.isArray(data.extractedData)
      ? data.extractedData
      : null;

  return extractedData
    ? { root: objectOrEmpty(data), extracted: extractedData }
    : { root: objectOrEmpty(data), extracted: objectOrEmpty(data) };
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function validateUserId(userId) {
  const normalized = String(userId || "").trim();

  if (!normalized) {
    throw createError("A userId is required.", 400);
  }

  return normalized;
}

function validateDate(date, label = "date") {
  const normalized = String(date || "").trim();

  if (!isValidDateString(normalized)) {
    throw createError(`Invalid ${label}. Use YYYY-MM-DD.`, 400);
  }

  return normalized;
}

function validateMemoryKey(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (!["identity", "health-picture", "onboarding"].includes(normalized)) {
    throw createError("Invalid memory file key.", 400);
  }

  return normalized;
}

function validateSummaryType(type) {
  const normalized = String(type || "").trim().toLowerCase();

  if (!["daily", "weekly", "monthly", "quarterly", "yearly"].includes(normalized)) {
    throw createError("Invalid summary type.", 400);
  }

  return normalized;
}

function validateThreadDate(date) {
  return validateDate(date, "thread date");
}

function getMemoryFileDefaultContent(key) {
  const { buildDefaultIdentityMarkdown, buildDefaultHealthPictureMarkdown } = require("./profile");
  const normalizedKey = validateMemoryKey(key);

  if (normalizedKey === "identity") {
    return buildDefaultIdentityMarkdown();
  }

  if (normalizedKey === "health-picture") {
    return buildDefaultHealthPictureMarkdown();
  }

  return "";
}

function validateYearMonth(yearMonth) {
  const normalized = String(yearMonth || "").trim();

  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw createError("Invalid yearMonth. Use YYYY-MM.", 400);
  }

  return normalized;
}

function getMonthRange(yearMonth) {
  const normalized = validateYearMonth(yearMonth);
  const [yearValue, monthValue] = normalized.split("-").map(Number);
  const startDate = `${normalized}-01`;
  const lastDay = new Date(yearValue, monthValue, 0).getDate();
  const endDate = `${normalized}-${String(lastDay).padStart(2, "0")}`;

  return { startDate, endDate };
}

function sortByDateAscending(items) {
  return [...items].sort((left, right) => String(left?.date || "").localeCompare(String(right?.date || "")));
}


function average(values) {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function extractMetric(log, metricKey) {
  switch (metricKey) {
    case "sleepHours":
      return numberOrNull(log?.vitals?.sleep?.hours);
    case "sleepQuality":
      return numberOrNull(log?.vitals?.sleep?.quality);
    case "energyMorning":
      return numberOrNull(log?.vitals?.energy?.morning);
    case "energyEvening":
      return numberOrNull(log?.vitals?.energy?.evening);
    case "mood":
      return numberOrNull(log?.vitals?.mood);
    case "stress":
      return numberOrNull(log?.vitals?.stress);
    default:
      return null;
  }
}

function computeAverageEnergy(log) {
  const values = [
    numberOrNull(log?.vitals?.energy?.morning),
    numberOrNull(log?.vitals?.energy?.evening)
  ].filter((value) => value !== null);

  return average(values);
}

function computeAverages(logs) {
  const metrics = {
    sleepHours: [],
    sleepQuality: [],
    energyMorning: [],
    energyEvening: [],
    mood: [],
    stress: []
  };

  for (const log of logs) {
    for (const metricKey of Object.keys(metrics)) {
      const value = extractMetric(log, metricKey);

      if (value !== null) {
        metrics[metricKey].push(value);
      }
    }
  }

  return {
    sleepHours: average(metrics.sleepHours),
    sleepQuality: average(metrics.sleepQuality),
    energyMorning: average(metrics.energyMorning),
    energyEvening: average(metrics.energyEvening),
    mood: average(metrics.mood),
    stress: average(metrics.stress)
  };
}

function supplementTaken(log, supplementName) {
  const target = String(supplementName || "").trim().toLowerCase();

  if (!target) {
    return false;
  }

  return Array.isArray(log?.supplements) && log.supplements.some((entry) => {
    if (typeof entry === "string") {
      return entry.trim().toLowerCase() === target;
    }

    if (!entry || typeof entry !== "object") {
      return false;
    }

    return String(entry.name || "").trim().toLowerCase() === target && entry.taken !== false;
  });
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

async function query(text, params = []) {
  try {
    return await pool.query(text, params);
  } catch (error) {
    throw createError(error.message, 500);
  }
}

async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // ignore rollback failures; original error is more useful
    }

    throw error.statusCode ? error : createError(error.message, 500);
  } finally {
    client.release();
  }
}

async function initSchema() {
  logNeon("initSchema", { databaseUrlConfigured: Boolean(DATABASE_URL) });

  const statements = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
    `CREATE TABLE IF NOT EXISTS daily_logs (
      user_id        TEXT NOT NULL,
      date           DATE NOT NULL,
      vitals         JSONB,
      vitals_readings JSONB NOT NULL DEFAULT '[]',
      supplements    JSONB,
      symptoms       JSONB,
      intake         JSONB,
      exercise       JSONB,
      flare_day      BOOLEAN NOT NULL DEFAULT false,
      good_day       BOOLEAN NOT NULL DEFAULT false,
      journal        TEXT,
      journal_entries JSONB NOT NULL DEFAULT '[]',
      what_changed   TEXT,
      weather        JSONB,
      last_updated   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, date)
    );`,
    "CREATE INDEX IF NOT EXISTS daily_logs_flare_idx ON daily_logs (user_id, flare_day);",
    "CREATE INDEX IF NOT EXISTS daily_logs_good_idx ON daily_logs (user_id, good_day);",
    `CREATE TABLE IF NOT EXISTS lab_results (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             TEXT NOT NULL,
      collection_date     DATE NOT NULL,
      report_date         DATE,
      panel_name          TEXT,
      lab_name            TEXT,
      ordering_physician  TEXT,
      fasting             BOOLEAN,
      values              JSONB NOT NULL DEFAULT '[]',
      flagged_count       INT NOT NULL DEFAULT 0,
      borderline_count    INT NOT NULL DEFAULT 0,
      normal_count        INT NOT NULL DEFAULT 0,
      raw_text            TEXT,
      source              TEXT,
      notes               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS lab_results_date_idx ON lab_results (user_id, collection_date DESC);",
    `CREATE TABLE IF NOT EXISTS prescriptions (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        TEXT NOT NULL,
      name           TEXT NOT NULL,
      dose           TEXT,
      frequency      TEXT,
      time_of_day    TEXT,
      purpose        TEXT,
      active         BOOLEAN NOT NULL DEFAULT true,
      date_started   DATE,
      source         TEXT,
      notes          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS prescriptions_active_idx ON prescriptions (user_id, active);",
    `CREATE TABLE IF NOT EXISTS supplements (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT NOT NULL,
      name          TEXT NOT NULL,
      brand         TEXT,
      form          TEXT,
      serving_size  TEXT,
      dose          TEXT,
      frequency     TEXT,
      time_of_day   TEXT,
      purpose       TEXT,
      active        BOOLEAN NOT NULL DEFAULT true,
      date_started  DATE,
      source        TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS supplements_active_idx ON supplements (user_id, active);",
    `CREATE TABLE IF NOT EXISTS supplement_ingredients (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supplement_id   UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      amount          TEXT,
      unit            TEXT,
      daily_value_pct TEXT
    );`,
    "CREATE INDEX IF NOT EXISTS ingredients_supplement_idx ON supplement_ingredients (supplement_id);",
    `CREATE TABLE IF NOT EXISTS doctor_visits (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           TEXT NOT NULL,
      visit_date        DATE NOT NULL,
      provider          TEXT,
      provider_credentials TEXT,
      practice          TEXT,
      visit_type        TEXT,
      patient_name_as_written TEXT,
      summary_markdown  TEXT,
      source_file_name  TEXT,
      warnings          JSONB NOT NULL DEFAULT '[]',
      diagnoses         JSONB,
      instructions      JSONB,
      referrals         JSONB,
      follow_up         TEXT,
      raw_text          TEXT,
      notes             TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE TABLE IF NOT EXISTS google_connections (
      user_id         TEXT PRIMARY KEY,
      access_token    TEXT NOT NULL,
      refresh_token   TEXT,
      scope           TEXT,
      token_type      TEXT,
      expiry_date     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE TABLE IF NOT EXISTS recurring_schedules (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT NOT NULL,
      title         TEXT NOT NULL,
      category      TEXT,
      days_of_week  TEXT[] NOT NULL DEFAULT '{}',
      start_time    TIME,
      end_time      TIME,
      location      TEXT,
      drain_level   TEXT,
      flexibility   TEXT,
      active        BOOLEAN NOT NULL DEFAULT true,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS recurring_schedules_user_idx ON recurring_schedules (user_id, active);",
    `CREATE TABLE IF NOT EXISTS planning_preferences (
      user_id                                     TEXT PRIMARY KEY,
      prioritize_recovery_when_symptoms_elevated  BOOLEAN NOT NULL DEFAULT true,
      prefer_workout_time                         TEXT NOT NULL DEFAULT 'no_preference',
      prefer_task_type_first                      TEXT NOT NULL DEFAULT 'no_preference',
      leave_buffer_after_work                     BOOLEAN NOT NULL DEFAULT true,
      default_buffer_mins                         INT NOT NULL DEFAULT 30,
      avoid_intense_exercise_after_poor_sleep     BOOLEAN NOT NULL DEFAULT true,
      prefer_lighter_days_after_high_drain_days   BOOLEAN NOT NULL DEFAULT true,
      notes                                       TEXT,
      updated_at                                  TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    `CREATE TABLE IF NOT EXISTS automations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       TEXT NOT NULL,
      type          TEXT NOT NULL,
      name          TEXT NOT NULL,
      message       TEXT,
      instructions  TEXT,
      channel       TEXT NOT NULL DEFAULT 'telegram',
      schedule_type TEXT NOT NULL,
      occurrences   JSONB NOT NULL DEFAULT '[]',
      days_of_week  TEXT[] NOT NULL DEFAULT '{}',
      times_of_day  TEXT[] NOT NULL DEFAULT '{}',
      start_date    DATE,
      end_date      DATE,
      timezone      TEXT NOT NULL DEFAULT 'America/New_York',
      enabled       BOOLEAN NOT NULL DEFAULT true,
      next_run_at   TIMESTAMPTZ,
      last_run_at   TIMESTAMPTZ,
      last_status   TEXT,
      last_error    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS automations_due_idx ON automations (enabled, next_run_at) WHERE enabled = true;",
    `CREATE TABLE IF NOT EXISTS automation_runs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id  UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      user_id        TEXT NOT NULL,
      scheduled_for  TIMESTAMPTZ NOT NULL,
      started_at     TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      status         TEXT NOT NULL,
      message_text   TEXT,
      error_message  TEXT,
      UNIQUE (automation_id, scheduled_for)
    );`,
    "CREATE INDEX IF NOT EXISTS automation_runs_lookup_idx ON automation_runs (user_id, automation_id, scheduled_for DESC);",
    `CREATE TABLE IF NOT EXISTS visited_pages (
      user_id    TEXT NOT NULL,
      page_key   TEXT NOT NULL CHECK (page_key IN ('dashboard', 'chat', 'records', 'schedules', 'automations', 'trends', 'notes')),
      visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, page_key)
    );`,
    `CREATE TABLE IF NOT EXISTS calendar_events (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                    TEXT NOT NULL,
      google_event_id            TEXT NOT NULL,
      calendar_id                TEXT,
      calendar_name              TEXT,
      title                      TEXT NOT NULL,
      start_time                 TIMESTAMPTZ,
      end_time                   TIMESTAMPTZ,
      all_day                    BOOLEAN NOT NULL DEFAULT false,
      location                   TEXT,
      description                TEXT,
      include_planning           BOOLEAN NOT NULL DEFAULT true,
      include_health_ctx         BOOLEAN NOT NULL DEFAULT true,
      include_morning_brief      BOOLEAN NOT NULL DEFAULT true,
      last_synced                TIMESTAMPTZ,
      created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id, google_event_id)
    );`,
    "CREATE INDEX IF NOT EXISTS calendar_events_user_time_idx ON calendar_events (user_id, start_time);",
    `CREATE TABLE IF NOT EXISTS memory_files (
      user_id     TEXT NOT NULL,
      key         TEXT NOT NULL,
      content     TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );`,
    `CREATE TABLE IF NOT EXISTS memory_file_archives (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL,
      key         TEXT NOT NULL,
      label       TEXT NOT NULL,
      content     TEXT NOT NULL,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
    "CREATE INDEX IF NOT EXISTS memory_file_archives_lookup_idx ON memory_file_archives (user_id, key, archived_at DESC);",
    `CREATE TABLE IF NOT EXISTS user_lists (
      user_id     TEXT NOT NULL,
      key         TEXT NOT NULL,
      items       JSONB NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );`,
    `CREATE TABLE IF NOT EXISTS summaries (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     TEXT NOT NULL,
      type        TEXT NOT NULL,
      period      TEXT NOT NULL,
      content     TEXT NOT NULL,
      edited_manually BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, type, period)
    );`,
    "CREATE INDEX IF NOT EXISTS summaries_lookup_idx ON summaries (user_id, type, period DESC);",
    `CREATE TABLE IF NOT EXISTS threads (
      user_id     TEXT NOT NULL,
      date        DATE NOT NULL,
      content     TEXT NOT NULL DEFAULT '',
      archived    BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, date)
    );`,
    "CREATE INDEX IF NOT EXISTS threads_lookup_idx ON threads (user_id, archived, date DESC);",
    `CREATE TABLE IF NOT EXISTS ai_request_logs (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            TEXT NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      session_id         TEXT,
      source             TEXT NOT NULL,
      label              TEXT NOT NULL,
      model              TEXT NOT NULL,
      input_text         TEXT,
      output_text        TEXT,
      input_tokens       INT NOT NULL DEFAULT 0,
      output_tokens      INT NOT NULL DEFAULT 0,
      cached_tokens      INT NOT NULL DEFAULT 0,
      total_tokens       INT NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
      latency_ms         INT,
      success            BOOLEAN NOT NULL DEFAULT true,
      error_message      TEXT,
      truncated_at       TIMESTAMPTZ,
      metadata           JSONB
    );`,
    "CREATE INDEX IF NOT EXISTS ai_logs_created_idx ON ai_request_logs (user_id, created_at DESC);",
    "CREATE INDEX IF NOT EXISTS ai_logs_source_idx ON ai_request_logs (user_id, source);",
    "CREATE INDEX IF NOT EXISTS ai_logs_model_idx ON ai_request_logs (user_id, model);",
    "CREATE INDEX IF NOT EXISTS ai_logs_success_idx ON ai_request_logs (user_id, success);",
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS edited_manually BOOLEAN NOT NULL DEFAULT false;",
    "ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS vitals_readings JSONB NOT NULL DEFAULT '[]';",
    "ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS journal_entries JSONB NOT NULL DEFAULT '[]';",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS provider_credentials TEXT;",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS patient_name_as_written TEXT;",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS summary_markdown TEXT;",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS source_file_name TEXT;",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS warnings JSONB NOT NULL DEFAULT '[]';",
    "ALTER TABLE doctor_visits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();",
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conrelid = 'visited_pages'::regclass
           AND conname = 'visited_pages_page_key_check'
           AND pg_get_constraintdef(oid) NOT LIKE '%trends%'
       ) THEN
         ALTER TABLE visited_pages DROP CONSTRAINT visited_pages_page_key_check;
         ALTER TABLE visited_pages ADD CONSTRAINT visited_pages_page_key_check
           CHECK (page_key IN ('dashboard', 'chat', 'records', 'schedules', 'automations', 'trends', 'notes'));
       END IF;
     END $$;`
  ];

  for (const statement of statements) {
    await query(statement);
  }

  logNeon("initSchema complete");
}

function dailyLogRowToLog(row) {
  if (!row) {
    return null;
  }

  const vitals = objectOrEmpty(row.vitals);

  return {
    userId: row.user_id,
    date: dateOnlyOrNull(row.date),
    lastUpdated: toIsoTimestamp(row.last_updated),
    vitals: {
      ...vitals,
      goodDay:
        vitals.goodDay === null || vitals.goodDay === undefined
          ? boolOrDefault(row.good_day, false)
          : Boolean(vitals.goodDay)
    },
    supplements: arrayOrEmpty(row.supplements),
    symptoms: arrayOrEmpty(row.symptoms),
    intake: objectOrEmpty(row.intake),
    exercise: arrayOrEmpty(row.exercise),
    flareDay: boolOrDefault(row.flare_day, false),
    goodDay: undefined,
    journal: textOrNull(row.journal),
    journalEntries:
      arrayOrEmpty(row.journal_entries).length > 0
        ? arrayOrEmpty(row.journal_entries)
        : (textOrNull(row.journal)
            ? [
                {
                  id: "legacy-journal-entry",
                  time: null,
                  note: textOrNull(row.journal)
                }
              ]
            : []),
    vitalsReadings: arrayOrEmpty(row.vitals_readings),
    whatChanged: textOrNull(row.what_changed),
    weather: row.weather || null
  };
}

function labRowToRecord(row) {
  const values = arrayOrEmpty(row?.values);

  return {
    id: row.id,
    userId: row.user_id,
    recordId: row.id,
    type: "lab_results",
    date: dateOnlyOrNull(row.collection_date),
    source: textOrNull(row.source) || textOrNull(row.lab_name) || "Unknown source",
    notes: textOrNull(row.notes),
    extractedData: {
      labName: textOrNull(row.lab_name) || textOrNull(row.source),
      collectionDate: dateOnlyOrNull(row.collection_date),
      reportDate: dateOnlyOrNull(row.report_date),
      orderingPhysician: textOrNull(row.ordering_physician),
      panelName: textOrNull(row.panel_name),
      fasting: typeof row.fasting === "boolean" ? row.fasting : null,
      values
    },
    rawText: textOrNull(row.raw_text),
    flaggedCount: numberOrZero(row.flagged_count),
    borderlineCount: numberOrZero(row.borderline_count),
    normalCount: numberOrZero(row.normal_count),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function prescriptionRowToRecord(row) {
  return {
    id: row.id,
    userId: row.user_id,
    recordId: row.id,
    type: "prescription",
    date: dateOnlyOrNull(row.date_started) || dateOnlyOrNull(row.created_at),
    source: textOrNull(row.source) || "Unknown source",
    notes: textOrNull(row.notes),
    extractedData: {
      medicationName: textOrNull(row.name),
      dose: textOrNull(row.dose),
      frequency: textOrNull(row.frequency),
      timeOfDay: textOrNull(row.time_of_day),
      purpose: textOrNull(row.purpose),
      active: boolOrDefault(row.active, true)
    },
    rawText: null,
    flaggedCount: 0,
    borderlineCount: 0,
    normalCount: 0,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function supplementRowToRecord(row, ingredients = []) {
  return {
    id: row.id,
    userId: row.user_id,
    recordId: row.id,
    type: "supplement",
    date: dateOnlyOrNull(row.date_started) || dateOnlyOrNull(row.created_at),
    source: textOrNull(row.source) || "Unknown source",
    notes: textOrNull(row.notes),
    extractedData: {
      medicationName: textOrNull(row.name),
      brand: textOrNull(row.brand),
      form: textOrNull(row.form),
      servingSize: textOrNull(row.serving_size),
      dose: textOrNull(row.dose),
      frequency: textOrNull(row.frequency),
      timeOfDay: textOrNull(row.time_of_day),
      purpose: textOrNull(row.purpose),
      active: boolOrDefault(row.active, true),
      ingredients: normalizeSupplementIngredients(ingredients)
    },
    rawText: null,
    flaggedCount: 0,
    borderlineCount: 0,
    normalCount: 0,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function doctorVisitRowToRecord(row) {
  return {
    id: row.id,
    userId: row.user_id,
    recordId: row.id,
    type: "doctor_visit",
    date: dateOnlyOrNull(row.visit_date),
    source: textOrNull(row.practice) || textOrNull(row.provider) || "Unknown source",
    notes: textOrNull(row.notes),
    extractedData: {
      provider: textOrNull(row.provider),
      providerCredentials: textOrNull(row.provider_credentials),
      practice: textOrNull(row.practice),
      visitType: textOrNull(row.visit_type),
      patientNameAsWritten: textOrNull(row.patient_name_as_written),
      summaryMarkdown: textOrNull(row.summary_markdown),
      sourceFileName: textOrNull(row.source_file_name),
      warnings: arrayOrEmpty(row.warnings),
      diagnoses: arrayOrEmpty(row.diagnoses),
      instructions: arrayOrEmpty(row.instructions),
      referrals: arrayOrEmpty(row.referrals),
      followUp: textOrNull(row.follow_up)
    },
    rawText: textOrNull(row.raw_text),
    flaggedCount: 0,
    borderlineCount: 0,
    normalCount: 0,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at || row.created_at)
  };
}

async function getIngredientsBySupplementIds(supplementIds) {
  const ids = arrayOrEmpty(supplementIds).filter(Boolean);

  if (!ids.length) {
    return new Map();
  }

  const result = await query(
    `SELECT id, supplement_id, name, amount, unit, daily_value_pct
     FROM supplement_ingredients
     WHERE supplement_id = ANY($1::uuid[])
     ORDER BY name ASC`,
    [ids]
  );

  const grouped = new Map();

  for (const row of result.rows) {
    const key = row.supplement_id;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push({
      id: row.id,
      supplementId: row.supplement_id,
      name: textOrNull(row.name),
      amount: textOrNull(row.amount),
      unit: textOrNull(row.unit),
      dailyValuePercent: textOrNull(row.daily_value_pct)
    });
  }

  return grouped;
}

async function saveLabResult(userId, data) {
  const { root, extracted } = resolvePayload(data);
  const collectionDate = dateOnlyOrNull(root.date || extracted.collectionDate);

  if (!collectionDate) {
    throw createError("A lab collection date is required.", 400);
  }

  const values = arrayOrEmpty(extracted.values);
  logNeon("saveLabResult", { userId, collectionDate, valueCount: values.length });

  const result = await query(
    `INSERT INTO lab_results (
      user_id, collection_date, report_date, panel_name, lab_name, ordering_physician,
      fasting, values, flagged_count, borderline_count, normal_count, raw_text,
      source, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8::jsonb, $9, $10, $11, $12,
      $13, $14, $15, $16
    )
    RETURNING *`,
    [
      userId,
      collectionDate,
      dateOnlyOrNull(extracted.reportDate),
      textOrNull(extracted.panelName),
      textOrNull(extracted.labName) || textOrNull(root.source),
      textOrNull(extracted.orderingPhysician),
      typeof extracted.fasting === "boolean" ? extracted.fasting : null,
      JSON.stringify(values),
      numberOrZero(root.flaggedCount ?? extracted.flaggedCount),
      numberOrZero(root.borderlineCount ?? extracted.borderlineCount),
      numberOrZero(root.normalCount ?? extracted.normalCount),
      textOrNull(root.rawText ?? extracted.rawText),
      textOrNull(root.source) || textOrNull(extracted.labName) || "Unknown source",
      textOrNull(root.notes),
      timestampOrNow(root.createdAt),
      timestampOrNow(root.updatedAt)
    ]
  );

  return labRowToRecord(result.rows[0]);
}

async function updateLabResult(userId, id, data) {
  const { root, extracted } = resolvePayload(data);
  const collectionDate = dateOnlyOrNull(root.date || extracted.collectionDate);

  if (!collectionDate) {
    throw createError("A lab collection date is required.", 400);
  }

  logNeon("updateLabResult", { userId, id, collectionDate });
  const result = await query(
    `UPDATE lab_results
     SET collection_date = $3,
         report_date = $4,
         panel_name = $5,
         lab_name = $6,
         ordering_physician = $7,
         fasting = $8,
         values = $9::jsonb,
         flagged_count = $10,
         borderline_count = $11,
         normal_count = $12,
         raw_text = $13,
         source = $14,
         notes = $15,
         updated_at = $16
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      collectionDate,
      dateOnlyOrNull(extracted.reportDate),
      textOrNull(extracted.panelName),
      textOrNull(extracted.labName) || textOrNull(root.source),
      textOrNull(extracted.orderingPhysician),
      typeof extracted.fasting === "boolean" ? extracted.fasting : null,
      JSON.stringify(arrayOrEmpty(extracted.values)),
      numberOrZero(root.flaggedCount ?? extracted.flaggedCount),
      numberOrZero(root.borderlineCount ?? extracted.borderlineCount),
      numberOrZero(root.normalCount ?? extracted.normalCount),
      textOrNull(root.rawText ?? extracted.rawText),
      textOrNull(root.source) || textOrNull(extracted.labName) || "Unknown source",
      textOrNull(root.notes),
      timestampOrNow(root.updatedAt)
    ]
  );

  if (!result.rows.length) {
    throw createError("Record not found.", 404);
  }

  return labRowToRecord(result.rows[0]);
}

async function getLabResults(userId) {
  logNeon("getLabResults", { userId });
  const result = await query(
    `SELECT * FROM lab_results
     WHERE user_id = $1
     ORDER BY collection_date DESC, created_at DESC`,
    [userId]
  );

  return result.rows.map(labRowToRecord);
}

async function getLabResult(userId, id) {
  logNeon("getLabResult", { userId, id });
  const result = await query(
    `SELECT * FROM lab_results WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id]
  );

  return result.rows.length ? labRowToRecord(result.rows[0]) : null;
}

async function deleteLabResult(userId, id) {
  logNeon("deleteLabResult", { userId, id });
  const result = await query(
    `DELETE FROM lab_results WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id]
  );

  return result.rows.length ? labRowToRecord(result.rows[0]) : null;
}

async function getLatestLabValues(userId) {
  logNeon("getLatestLabValues", { userId });
  const result = await query(
    `SELECT id, collection_date, source, values
     FROM lab_results
     WHERE user_id = $1
     ORDER BY collection_date DESC, created_at DESC
     LIMIT 2`,
    [userId]
  );

  const latestByName = new Map();

  for (const row of result.rows) {
    for (const entry of arrayOrEmpty(row.values)) {
      const name = textOrNull(entry?.name);
      const key = String(name || "").toLowerCase();

      if (!name || latestByName.has(key)) {
        continue;
      }

      latestByName.set(key, {
        name,
        value: entry?.value ?? null,
        unit: textOrNull(entry?.unit),
        flag: textOrNull(entry?.flag) || "normal",
        rangeText: textOrNull(entry?.rangeText),
        date: dateOnlyOrNull(row.collection_date),
        source: textOrNull(row.source),
        recordId: row.id
      });
    }
  }

  return [...latestByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function savePrescription(userId, data) {
  const { root, extracted } = resolvePayload(data);
  const name = textOrNull(extracted.medicationName ?? extracted.name);

  if (!name) {
    throw createError("A prescription name is required.", 400);
  }

  logNeon("savePrescription", { userId, name });
  const result = await query(
    `INSERT INTO prescriptions (
      user_id, name, dose, frequency, time_of_day, purpose,
      active, date_started, source, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12
    )
    RETURNING *`,
    [
      userId,
      name,
      textOrNull(extracted.dose),
      textOrNull(extracted.frequency),
      textOrNull(extracted.timeOfDay),
      textOrNull(extracted.purpose),
      boolOrDefault(extracted.active, true),
      dateOnlyOrNull(root.date || extracted.dateStarted),
      textOrNull(root.source),
      textOrNull(root.notes ?? extracted.notes),
      timestampOrNow(root.createdAt),
      timestampOrNow(root.updatedAt)
    ]
  );

  return prescriptionRowToRecord(result.rows[0]);
}

async function getPrescriptions(userId) {
  logNeon("getPrescriptions", { userId });
  const result = await query(
    `SELECT * FROM prescriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map(prescriptionRowToRecord);
}

async function getActivePrescriptions(userId) {
  logNeon("getActivePrescriptions", { userId });
  const result = await query(
    `SELECT * FROM prescriptions WHERE user_id = $1 AND active = true ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows.map(prescriptionRowToRecord);
}

async function getPrescription(userId, id) {
  logNeon("getPrescription", { userId, id });
  const result = await query(
    `SELECT * FROM prescriptions WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id]
  );

  return result.rows.length ? prescriptionRowToRecord(result.rows[0]) : null;
}

async function updatePrescription(userId, id, data) {
  const { root, extracted } = resolvePayload(data);
  const name = textOrNull(extracted.medicationName ?? extracted.name);

  if (!name) {
    throw createError("A prescription name is required.", 400);
  }

  logNeon("updatePrescription", { userId, id, name });
  const result = await query(
    `UPDATE prescriptions
     SET name = $3,
         dose = $4,
         frequency = $5,
         time_of_day = $6,
         purpose = $7,
         active = $8,
         date_started = $9,
         source = $10,
         notes = $11,
         updated_at = $12
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      name,
      textOrNull(extracted.dose),
      textOrNull(extracted.frequency),
      textOrNull(extracted.timeOfDay),
      textOrNull(extracted.purpose),
      boolOrDefault(extracted.active, true),
      dateOnlyOrNull(root.date || extracted.dateStarted),
      textOrNull(root.source),
      textOrNull(root.notes ?? extracted.notes),
      timestampOrNow(root.updatedAt)
    ]
  );

  if (!result.rows.length) {
    throw createError("Record not found.", 404);
  }

  return prescriptionRowToRecord(result.rows[0]);
}

async function deletePrescription(userId, id) {
  logNeon("deletePrescription", { userId, id });
  const result = await query(
    `DELETE FROM prescriptions WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id]
  );

  return result.rows.length ? prescriptionRowToRecord(result.rows[0]) : null;
}

async function saveSupplement(userId, data) {
  const { root, extracted } = resolvePayload(data);
  const name = textOrNull(extracted.medicationName ?? extracted.name);

  if (!name) {
    throw createError("A supplement name is required.", 400);
  }

  return withTransaction(async (client) => {
    logNeon("saveSupplement", {
      userId,
      name,
      ingredientCount: normalizeSupplementIngredients(extracted.ingredients).length
    });

    const supplementResult = await client.query(
      `INSERT INTO supplements (
        user_id, name, brand, form, serving_size, dose, frequency,
        time_of_day, purpose, active, date_started, source, notes,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15
      )
      RETURNING *`,
      [
        userId,
        name,
        textOrNull(extracted.brand),
        textOrNull(extracted.form),
        textOrNull(extracted.servingSize),
        textOrNull(extracted.dose),
        textOrNull(extracted.frequency),
        textOrNull(extracted.timeOfDay),
        textOrNull(extracted.purpose),
        boolOrDefault(extracted.active, true),
        dateOnlyOrNull(root.date || extracted.dateStarted),
        textOrNull(root.source) || textOrNull(extracted.brand),
        textOrNull(root.notes ?? extracted.notes),
        timestampOrNow(root.createdAt),
        timestampOrNow(root.updatedAt)
      ]
    );

    const supplementRow = supplementResult.rows[0];
    const ingredients = normalizeSupplementIngredients(extracted.ingredients);

    for (const ingredient of ingredients) {
      await client.query(
        `INSERT INTO supplement_ingredients (
          supplement_id, name, amount, unit, daily_value_pct
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          supplementRow.id,
          ingredient.name,
          ingredient.amount,
          ingredient.unit,
          ingredient.dailyValuePercent
        ]
      );
    }

    return supplementRowToRecord(supplementRow, ingredients);
  });
}

async function getSupplements(userId) {
  logNeon("getSupplements", { userId });
  const supplementsResult = await query(
    `SELECT * FROM supplements
     WHERE user_id = $1
     ORDER BY active DESC, name ASC, created_at DESC`,
    [userId]
  );
  const rows = supplementsResult.rows;
  const ingredientMap = await getIngredientsBySupplementIds(rows.map((row) => row.id));
  return rows.map((row) => supplementRowToRecord(row, ingredientMap.get(row.id) || []));
}

async function getActiveSupplements(userId) {
  logNeon("getActiveSupplements", { userId });
  const supplementsResult = await query(
    `SELECT * FROM supplements
     WHERE user_id = $1 AND active = true
     ORDER BY name ASC, created_at DESC`,
    [userId]
  );
  const rows = supplementsResult.rows;
  const ingredientMap = await getIngredientsBySupplementIds(rows.map((row) => row.id));
  return rows.map((row) => supplementRowToRecord(row, ingredientMap.get(row.id) || []));
}

async function getSupplement(userId, id) {
  logNeon("getSupplement", { userId, id });
  const result = await query(
    `SELECT * FROM supplements WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  const ingredientMap = await getIngredientsBySupplementIds([row.id]);
  return supplementRowToRecord(row, ingredientMap.get(row.id) || []);
}

async function updateSupplement(userId, id, data) {
  const { root, extracted } = resolvePayload(data);
  const name = textOrNull(extracted.medicationName ?? extracted.name);

  if (!name) {
    throw createError("A supplement name is required.", 400);
  }

  return withTransaction(async (client) => {
    logNeon("updateSupplement", {
      userId,
      id,
      name,
      ingredientCount: normalizeSupplementIngredients(extracted.ingredients).length
    });

    const supplementResult = await client.query(
      `UPDATE supplements
       SET name = $3,
           brand = $4,
           form = $5,
           serving_size = $6,
           dose = $7,
           frequency = $8,
           time_of_day = $9,
           purpose = $10,
           active = $11,
           date_started = $12,
           source = $13,
           notes = $14,
           updated_at = $15
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      [
        userId,
        id,
        name,
        textOrNull(extracted.brand),
        textOrNull(extracted.form),
        textOrNull(extracted.servingSize),
        textOrNull(extracted.dose),
        textOrNull(extracted.frequency),
        textOrNull(extracted.timeOfDay),
        textOrNull(extracted.purpose),
        boolOrDefault(extracted.active, true),
        dateOnlyOrNull(root.date || extracted.dateStarted),
        textOrNull(root.source) || textOrNull(extracted.brand),
        textOrNull(root.notes ?? extracted.notes),
        timestampOrNow(root.updatedAt)
      ]
    );

    if (!supplementResult.rows.length) {
      throw createError("Record not found.", 404);
    }

    await client.query(`DELETE FROM supplement_ingredients WHERE supplement_id = $1`, [id]);

    const ingredients = normalizeSupplementIngredients(extracted.ingredients);

    for (const ingredient of ingredients) {
      await client.query(
        `INSERT INTO supplement_ingredients (
          supplement_id, name, amount, unit, daily_value_pct
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          ingredient.name,
          ingredient.amount,
          ingredient.unit,
          ingredient.dailyValuePercent
        ]
      );
    }

    return supplementRowToRecord(supplementResult.rows[0], ingredients);
  });
}

async function deleteSupplement(userId, id) {
  logNeon("deleteSupplement", { userId, id });
  const existing = await getSupplement(userId, id);

  if (!existing) {
    return null;
  }

  await query(`DELETE FROM supplements WHERE user_id = $1 AND id = $2`, [userId, id]);
  return existing;
}

async function getNutrientRollup(userId, nutrientName) {
  const normalizedName = String(nutrientName || "").trim();

  if (!normalizedName) {
    throw createError("A nutrient name is required.", 400);
  }

  logNeon("getNutrientRollup", { userId, nutrientName: normalizedName });
  const result = await query(
    `SELECT i.name, i.amount, i.unit
     FROM supplement_ingredients i
     INNER JOIN supplements s ON s.id = i.supplement_id
     WHERE s.user_id = $1
       AND s.active = true
       AND i.name ILIKE $2`,
    [userId, `%${normalizedName}%`]
  );

  let total = 0;
  let count = 0;
  const units = new Set();

  for (const row of result.rows) {
    const numeric = Number.parseFloat(String(row.amount ?? "").replace(/[^\d.-]/g, ""));

    if (!Number.isFinite(numeric)) {
      continue;
    }

    total += numeric;
    count += 1;

    const unit = textOrNull(row.unit);
    if (unit) {
      units.add(unit);
    }
  }

  return {
    nutrientName: normalizedName,
    total: count ? Number(total.toFixed(2)) : 0,
    unit: units.size === 1 ? [...units][0] : null,
    matchedIngredients: result.rows.length
  };
}

async function saveDoctorVisit(userId, data) {
  const { root, extracted } = resolvePayload(data);
  const visitDate = dateOnlyOrNull(root.date || extracted.visitDate);

  if (!visitDate) {
    throw createError("A doctor visit date is required.", 400);
  }

  logNeon("saveDoctorVisit", { userId, visitDate });
  const result = await query(
    `INSERT INTO doctor_visits (
      user_id, visit_date, provider, provider_credentials, practice, visit_type,
      patient_name_as_written, summary_markdown, source_file_name, warnings,
      diagnoses, instructions, referrals, follow_up, raw_text, notes, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10::jsonb,
      $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $17
    )
    RETURNING *`,
    [
      userId,
      visitDate,
      textOrNull(extracted.provider),
      textOrNull(extracted.providerCredentials),
      textOrNull(extracted.practice) || textOrNull(root.source),
      textOrNull(extracted.visitType),
      textOrNull(extracted.patientNameAsWritten),
      textOrNull(extracted.summaryMarkdown),
      textOrNull(extracted.sourceFileName),
      JSON.stringify(arrayOrEmpty(extracted.warnings)),
      JSON.stringify(arrayOrEmpty(extracted.diagnoses)),
      JSON.stringify(arrayOrEmpty(extracted.instructions)),
      JSON.stringify(arrayOrEmpty(extracted.referrals)),
      textOrNull(extracted.followUp),
      textOrNull(root.rawText ?? extracted.rawText),
      textOrNull(root.notes ?? extracted.notes),
      timestampOrNow(root.createdAt)
    ]
  );

  return doctorVisitRowToRecord(result.rows[0]);
}

async function updateDoctorVisit(userId, id, data) {
  const { root, extracted } = resolvePayload(data);
  const visitDate = dateOnlyOrNull(root.date || extracted.visitDate);

  if (!visitDate) {
    throw createError("A doctor visit date is required.", 400);
  }

  logNeon("updateDoctorVisit", { userId, id, visitDate });
  const result = await query(
    `UPDATE doctor_visits
     SET visit_date = $3,
         provider = $4,
         provider_credentials = $5,
         practice = $6,
         visit_type = $7,
         patient_name_as_written = $8,
         summary_markdown = $9,
         source_file_name = $10,
         warnings = $11::jsonb,
         diagnoses = $12::jsonb,
         instructions = $13::jsonb,
         referrals = $14::jsonb,
         follow_up = $15,
         raw_text = $16,
         notes = $17,
         updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      visitDate,
      textOrNull(extracted.provider),
      textOrNull(extracted.providerCredentials),
      textOrNull(extracted.practice) || textOrNull(root.source),
      textOrNull(extracted.visitType),
      textOrNull(extracted.patientNameAsWritten),
      textOrNull(extracted.summaryMarkdown),
      textOrNull(extracted.sourceFileName),
      JSON.stringify(arrayOrEmpty(extracted.warnings)),
      JSON.stringify(arrayOrEmpty(extracted.diagnoses)),
      JSON.stringify(arrayOrEmpty(extracted.instructions)),
      JSON.stringify(arrayOrEmpty(extracted.referrals)),
      textOrNull(extracted.followUp),
      textOrNull(root.rawText ?? extracted.rawText),
      textOrNull(root.notes ?? extracted.notes)
    ]
  );

  if (!result.rows.length) {
    throw createError("Record not found.", 404);
  }

  return doctorVisitRowToRecord(result.rows[0]);
}

async function getDoctorVisits(userId) {
  logNeon("getDoctorVisits", { userId });
  const result = await query(
    `SELECT * FROM doctor_visits WHERE user_id = $1 ORDER BY visit_date DESC, created_at DESC`,
    [userId]
  );

  return result.rows.map(doctorVisitRowToRecord);
}

async function getDoctorVisit(userId, id) {
  logNeon("getDoctorVisit", { userId, id });
  const result = await query(
    `SELECT * FROM doctor_visits WHERE user_id = $1 AND id = $2 LIMIT 1`,
    [userId, id]
  );

  return result.rows.length ? doctorVisitRowToRecord(result.rows[0]) : null;
}

async function deleteDoctorVisit(userId, id) {
  logNeon("deleteDoctorVisit", { userId, id });
  const result = await query(
    `DELETE FROM doctor_visits WHERE user_id = $1 AND id = $2 RETURNING *`,
    [userId, id]
  );

  return result.rows.length ? doctorVisitRowToRecord(result.rows[0]) : null;
}

async function getLog(userId, date) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateDate(date);

  logNeon("getLog", { userId: normalizedUserId, date: normalizedDate });
  const result = await query(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [normalizedUserId, normalizedDate]
  );

  return result.rows.length ? dailyLogRowToLog(result.rows[0]) : null;
}

async function updateLog(userId, date, data) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateDate(date);

  if (!isPlainObject(data)) {
    throw createError("Log update payload must be a JSON object.", 400);
  }

  logNeon("updateLog", {
    userId: normalizedUserId,
    date: normalizedDate,
    keys: Object.keys(data)
  });

  const existingLog = await getLog(normalizedUserId, normalizedDate);
  const baseLog = existingLog || createEmptyDailyLog(normalizedDate);
  const mergedLog = mergeDeep(baseLog, data);
  mergedLog.userId = normalizedUserId;
  mergedLog.date = normalizedDate;
  mergedLog.lastUpdated = new Date().toISOString();

  const vitals = objectOrEmpty(mergedLog.vitals);

  const result = await query(
    `INSERT INTO daily_logs (
      user_id, date, vitals, vitals_readings, supplements, symptoms, intake, exercise,
      flare_day, good_day, journal, journal_entries, what_changed, weather, last_updated
    ) VALUES (
      $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
      $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15
    )
    ON CONFLICT (user_id, date) DO UPDATE SET
      vitals = EXCLUDED.vitals,
      vitals_readings = EXCLUDED.vitals_readings,
      supplements = EXCLUDED.supplements,
      symptoms = EXCLUDED.symptoms,
      intake = EXCLUDED.intake,
      exercise = EXCLUDED.exercise,
      flare_day = EXCLUDED.flare_day,
      good_day = EXCLUDED.good_day,
      journal = EXCLUDED.journal,
      journal_entries = EXCLUDED.journal_entries,
      what_changed = EXCLUDED.what_changed,
      weather = EXCLUDED.weather,
      last_updated = EXCLUDED.last_updated
    RETURNING *`,
    [
      normalizedUserId,
      normalizedDate,
      JSON.stringify(vitals),
      JSON.stringify(arrayOrEmpty(mergedLog.vitalsReadings)),
      JSON.stringify(arrayOrEmpty(mergedLog.supplements)),
      JSON.stringify(arrayOrEmpty(mergedLog.symptoms)),
      JSON.stringify(objectOrEmpty(mergedLog.intake)),
      JSON.stringify(arrayOrEmpty(mergedLog.exercise)),
      Boolean(mergedLog.flareDay),
      Boolean(vitals.goodDay),
      textOrNull(mergedLog.journal),
      JSON.stringify(arrayOrEmpty(mergedLog.journalEntries)),
      textOrNull(mergedLog.whatChanged),
      JSON.stringify(mergedLog.weather || null),
      mergedLog.lastUpdated
    ]
  );

  return dailyLogRowToLog(result.rows[0]);
}

async function replaceDailyLog(userId, date, logData) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateDate(date);
  const payload = objectOrEmpty(logData);
  const vitals = objectOrEmpty(payload.vitals);

  logNeon("replaceDailyLog", {
    userId: normalizedUserId,
    date: normalizedDate
  });

  const result = await query(
    `INSERT INTO daily_logs (
      user_id, date, vitals, vitals_readings, supplements, symptoms, intake, exercise,
      flare_day, good_day, journal, journal_entries, what_changed, weather, last_updated
    ) VALUES (
      $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
      $9, $10, $11, $12::jsonb, $13, $14::jsonb, $15
    )
    ON CONFLICT (user_id, date) DO UPDATE SET
      vitals = EXCLUDED.vitals,
      vitals_readings = EXCLUDED.vitals_readings,
      supplements = EXCLUDED.supplements,
      symptoms = EXCLUDED.symptoms,
      intake = EXCLUDED.intake,
      exercise = EXCLUDED.exercise,
      flare_day = EXCLUDED.flare_day,
      good_day = EXCLUDED.good_day,
      journal = EXCLUDED.journal,
      journal_entries = EXCLUDED.journal_entries,
      what_changed = EXCLUDED.what_changed,
      weather = EXCLUDED.weather,
      last_updated = EXCLUDED.last_updated
    RETURNING *`,
    [
      normalizedUserId,
      normalizedDate,
      JSON.stringify(vitals),
      JSON.stringify(arrayOrEmpty(payload.vitalsReadings)),
      JSON.stringify(arrayOrEmpty(payload.supplements)),
      JSON.stringify(arrayOrEmpty(payload.symptoms)),
      JSON.stringify(objectOrEmpty(payload.intake)),
      JSON.stringify(arrayOrEmpty(payload.exercise)),
      Boolean(payload.flareDay),
      Boolean(vitals.goodDay),
      textOrNull(payload.journal),
      JSON.stringify(arrayOrEmpty(payload.journalEntries)),
      textOrNull(payload.whatChanged),
      JSON.stringify(payload.weather || null),
      timestampOrNow(payload.lastUpdated)
    ]
  );

  return dailyLogRowToLog(result.rows[0]);
}

async function getDateRange(userId, startDate, endDate) {
  const normalizedUserId = validateUserId(userId);
  const normalizedStartDate = validateDate(startDate, "startDate");
  const normalizedEndDate = validateDate(endDate, "endDate");

  if (normalizedStartDate > normalizedEndDate) {
    throw createError("startDate must be before or equal to endDate.", 400);
  }

  logNeon("getDateRange", {
    userId: normalizedUserId,
    startDate: normalizedStartDate,
    endDate: normalizedEndDate
  });

  const result = await query(
    `SELECT * FROM daily_logs
     WHERE user_id = $1 AND date BETWEEN $2 AND $3
     ORDER BY date ASC`,
    [normalizedUserId, normalizedStartDate, normalizedEndDate]
  );

  return sortByDateAscending(result.rows.map(dailyLogRowToLog));
}

async function getMonthlyAverages(userId, yearMonth) {
  const normalizedUserId = validateUserId(userId);
  const normalizedYearMonth = validateYearMonth(yearMonth);
  const { startDate, endDate } = getMonthRange(normalizedYearMonth);

  logNeon("getMonthlyAverages", { userId: normalizedUserId, yearMonth: normalizedYearMonth });
  const logs = await getDateRange(normalizedUserId, startDate, endDate);

  return {
    userId: normalizedUserId,
    yearMonth: normalizedYearMonth,
    averages: computeAverages(logs)
  };
}

async function getFlareDays(userId, yearMonth) {
  const normalizedUserId = validateUserId(userId);
  const normalizedYearMonth = validateYearMonth(yearMonth);
  const { startDate, endDate } = getMonthRange(normalizedYearMonth);

  logNeon("getFlareDays", { userId: normalizedUserId, yearMonth: normalizedYearMonth });
  const logs = await getDateRange(normalizedUserId, startDate, endDate);
  return logs.filter((log) => log.flareDay === true);
}

async function getGoodDays(userId, yearMonth) {
  const normalizedUserId = validateUserId(userId);
  const normalizedYearMonth = validateYearMonth(yearMonth);
  const { startDate, endDate } = getMonthRange(normalizedYearMonth);

  logNeon("getGoodDays", { userId: normalizedUserId, yearMonth: normalizedYearMonth });
  const logs = await getDateRange(normalizedUserId, startDate, endDate);
  return logs.filter((log) => log?.vitals?.goodDay === true);
}

async function getSupplementHistory(userId, supplementName) {
  const normalizedUserId = validateUserId(userId);
  const normalizedSupplementName = String(supplementName || "").trim();

  if (!normalizedSupplementName) {
    throw createError("A supplementName is required.", 400);
  }

  logNeon("getSupplementHistory", { userId: normalizedUserId, supplementName: normalizedSupplementName });
  const result = await query(
    `SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date ASC`,
    [normalizedUserId]
  );

  return sortByDateAscending(
    result.rows
      .map(dailyLogRowToLog)
      .filter((log) => supplementTaken(log, normalizedSupplementName))
  );
}

async function getBestDays(userId, n) {
  const normalizedUserId = validateUserId(userId);
  const limit = Number(n);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw createError("n must be a positive integer.", 400);
  }

  logNeon("getBestDays", { userId: normalizedUserId, n: limit });
  const result = await query(
    `SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date ASC`,
    [normalizedUserId]
  );

  return result.rows
    .map(dailyLogRowToLog)
    .map((log) => ({
      ...log,
      averageEnergy: computeAverageEnergy(log)
    }))
    .filter((log) => log.averageEnergy !== null)
    .sort((left, right) => {
      if (right.averageEnergy !== left.averageEnergy) {
        return right.averageEnergy - left.averageEnergy;
      }

      return String(left.date || "").localeCompare(String(right.date || ""));
    })
    .slice(0, limit);
}

async function getWorstDays(userId, n) {
  const normalizedUserId = validateUserId(userId);
  const limit = Number(n);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw createError("n must be a positive integer.", 400);
  }

  logNeon("getWorstDays", { userId: normalizedUserId, n: limit });
  const result = await query(
    `SELECT * FROM daily_logs WHERE user_id = $1 ORDER BY date ASC`,
    [normalizedUserId]
  );

  return result.rows
    .map(dailyLogRowToLog)
    .map((log) => ({
      ...log,
      averageEnergy: computeAverageEnergy(log)
    }))
    .filter((log) => log.averageEnergy !== null)
    .sort((left, right) => {
      if (left.averageEnergy !== right.averageEnergy) {
        return left.averageEnergy - right.averageEnergy;
      }

      return String(left.date || "").localeCompare(String(right.date || ""));
    })
    .slice(0, limit);
}

function memoryFileRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    key: row.key,
    content: String(row.content || ""),
    updatedAt: toIsoTimestamp(row.updated_at)
  };
}

function summaryRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    period: row.period,
    content: String(row.content || ""),
    editedManually: Boolean(row.edited_manually),
    createdAt: toIsoTimestamp(row.created_at)
  };
}

function aiLogRowToRecord(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    createdAt: toIsoTimestamp(row.created_at),
    sessionId: textOrNull(row.session_id),
    source: textOrNull(row.source),
    label: textOrNull(row.label),
    model: textOrNull(row.model),
    inputText: row.input_text === null || row.input_text === undefined ? null : String(row.input_text),
    outputText: row.output_text === null || row.output_text === undefined ? null : String(row.output_text),
    inputTokens: numberOrZero(row.input_tokens),
    outputTokens: numberOrZero(row.output_tokens),
    cachedTokens: numberOrZero(row.cached_tokens),
    totalTokens: numberOrZero(row.total_tokens),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    success: boolOrDefault(row.success, true),
    errorMessage: textOrNull(row.error_message),
    truncatedAt: toIsoTimestamp(row.truncated_at),
    metadata: row.metadata || null
  };
}

function recurringScheduleRowToContext(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: textOrNull(row.title),
    category: textOrNull(row.category),
    daysOfWeek: arrayOrEmpty(row.days_of_week),
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    location: textOrNull(row.location),
    drainLevel: textOrNull(row.drain_level),
    flexibility: textOrNull(row.flexibility),
    notes: textOrNull(row.notes)
  };
}

function calendarEventRowToContext(row) {
  if (!row) {
    return null;
  }

  return {
    title: textOrNull(row.title),
    startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
    allDay: boolOrDefault(row.all_day, false),
    location: textOrNull(row.location),
    description: textOrNull(row.description)
  };
}

async function getMemoryFileRecord(userId, key) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = validateMemoryKey(key);

  logNeon("getMemoryFileRecord", {
    userId: normalizedUserId,
    key: normalizedKey
  });

  const result = await query(
    `SELECT * FROM memory_files
     WHERE user_id = $1 AND key = $2`,
    [normalizedUserId, normalizedKey]
  );

  if (!result.rows.length) {
    return {
      userId: normalizedUserId,
      key: normalizedKey,
      content: getMemoryFileDefaultContent(normalizedKey),
      updatedAt: null
    };
  }

  return memoryFileRowToRecord(result.rows[0]);
}

async function getMemoryFile(userId, key) {
  const record = await getMemoryFileRecord(userId, key);
  return record?.content || getMemoryFileDefaultContent(key);
}

async function saveMemoryFile(userId, key, content) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = validateMemoryKey(key);
  const normalizedContent =
    String(content || "").trim() || getMemoryFileDefaultContent(normalizedKey).trim();

  logNeon("saveMemoryFile", { userId: normalizedUserId, key: normalizedKey });
  const result = await query(
    `INSERT INTO memory_files (user_id, key, content, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, key)
     DO UPDATE SET content = EXCLUDED.content, updated_at = now()
     RETURNING *`,
    [normalizedUserId, normalizedKey, `${normalizedContent}\n`]
  );

  return memoryFileRowToRecord(result.rows[0]);
}

async function archiveMemoryFile(userId, key, label, content) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = validateMemoryKey(key);
  const normalizedLabel = String(label || "").trim();
  const normalizedContent = String(content || "").trim();

  if (!normalizedLabel) {
    throw createError("An archive label is required.", 400);
  }

  if (!normalizedContent) {
    throw createError("Archived memory content cannot be empty.", 400);
  }

  logNeon("archiveMemoryFile", {
    userId: normalizedUserId,
    key: normalizedKey,
    label: normalizedLabel
  });

  const result = await query(
    `INSERT INTO memory_file_archives (user_id, key, label, content)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [normalizedUserId, normalizedKey, normalizedLabel, `${normalizedContent}\n`]
  );

  return {
    id: result.rows[0].id,
    userId: result.rows[0].user_id,
    key: result.rows[0].key,
    label: result.rows[0].label,
    content: result.rows[0].content,
    archivedAt: toIsoTimestamp(result.rows[0].archived_at)
  };
}

async function getMemoryFileArchives(userId, key) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = validateMemoryKey(key);

  logNeon("getMemoryFileArchives", {
    userId: normalizedUserId,
    key: normalizedKey
  });

  const result = await query(
    `SELECT * FROM memory_file_archives
     WHERE user_id = $1 AND key = $2
     ORDER BY archived_at DESC`,
    [normalizedUserId, normalizedKey]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    key: row.key,
    label: row.label,
    content: String(row.content || ""),
    archivedAt: toIsoTimestamp(row.archived_at)
  }));
}

async function getUserList(userId, key) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = String(key || "").trim().toLowerCase();

  if (!normalizedKey) {
    throw createError("A user list key is required.", 400);
  }

  logNeon("getUserList", { userId: normalizedUserId, key: normalizedKey });
  const result = await query(
    `SELECT * FROM user_lists
     WHERE user_id = $1 AND key = $2`,
    [normalizedUserId, normalizedKey]
  );

  if (!result.rows.length) {
    return [];
  }

  return arrayOrEmpty(result.rows[0].items)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

async function saveUserList(userId, key, items) {
  const normalizedUserId = validateUserId(userId);
  const normalizedKey = String(key || "").trim().toLowerCase();

  if (!normalizedKey) {
    throw createError("A user list key is required.", 400);
  }

  const normalizedItems = Array.from(
    new Set(
      arrayOrEmpty(items)
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );

  logNeon("saveUserList", {
    userId: normalizedUserId,
    key: normalizedKey,
    count: normalizedItems.length
  });

  await query(
    `INSERT INTO user_lists (user_id, key, items, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, key)
     DO UPDATE SET items = EXCLUDED.items, updated_at = now()`,
    [normalizedUserId, normalizedKey, JSON.stringify(normalizedItems)]
  );

  return normalizedItems;
}

const TOUR_PAGE_KEYS = new Set([
  "dashboard", "chat", "records", "schedules", "automations", "trends", "notes"
]);

function validateTourPageKey(pageKey) {
  const normalized = String(pageKey || "").trim().toLowerCase();
  if (!TOUR_PAGE_KEYS.has(normalized)) {
    throw createError("Invalid tutorial page.", 400);
  }
  return normalized;
}

async function getVisitedPages(userId) {
  const normalizedUserId = validateUserId(userId);
  const result = await query(
    "SELECT page_key FROM visited_pages WHERE user_id = $1 ORDER BY visited_at ASC",
    [normalizedUserId]
  );
  return result.rows.map((row) => row.page_key);
}

async function markPageVisited(userId, pageKey) {
  const normalizedUserId = validateUserId(userId);
  const normalizedPageKey = validateTourPageKey(pageKey);
  await query(
    `INSERT INTO visited_pages (user_id, page_key)
     VALUES ($1, $2)
     ON CONFLICT (user_id, page_key) DO NOTHING`,
    [normalizedUserId, normalizedPageKey]
  );
  return normalizedPageKey;
}

async function saveSummary(userId, type, period, content, options = {}) {
  const normalizedUserId = validateUserId(userId);
  const normalizedType = validateSummaryType(type);
  const normalizedPeriod = String(period || "").trim().replace(/\.md$/i, "");
  const normalizedContent = String(content || "").trim();
  const editedManually = options.editedManually === true;

  if (!normalizedPeriod) {
    throw createError("A summary period is required.", 400);
  }

  if (!normalizedContent) {
    throw createError("Summary content cannot be empty.", 400);
  }

  logNeon("saveSummary", {
    userId: normalizedUserId,
    type: normalizedType,
    period: normalizedPeriod,
    editedManually
  });

  const result = await query(
    `INSERT INTO summaries (user_id, type, period, content, edited_manually, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, type, period)
     DO UPDATE SET
       content = EXCLUDED.content,
       edited_manually = EXCLUDED.edited_manually,
       created_at = now()
     RETURNING *`,
    [normalizedUserId, normalizedType, normalizedPeriod, normalizedContent, editedManually]
  );

  return summaryRowToRecord(result.rows[0]);
}

async function getSummary(userId, type, period) {
  const normalizedUserId = validateUserId(userId);
  const normalizedType = validateSummaryType(type);
  const normalizedPeriod = String(period || "").trim().replace(/\.md$/i, "");

  if (!normalizedPeriod) {
    throw createError("A summary period is required.", 400);
  }

  logNeon("getSummary", {
    userId: normalizedUserId,
    type: normalizedType,
    period: normalizedPeriod
  });

  const result = await query(
    `SELECT * FROM summaries
     WHERE user_id = $1 AND type = $2 AND period = $3`,
    [normalizedUserId, normalizedType, normalizedPeriod]
  );

  return result.rows.length ? summaryRowToRecord(result.rows[0]) : null;
}

async function listSummaries(userId, type) {
  const normalizedUserId = validateUserId(userId);
  const normalizedType = validateSummaryType(type);

  logNeon("listSummaries", { userId: normalizedUserId, type: normalizedType });
  const result = await query(
    `SELECT period, created_at, edited_manually
     FROM summaries
     WHERE user_id = $1 AND type = $2
     ORDER BY period DESC`,
    [normalizedUserId, normalizedType]
  );

  return result.rows.map((row) => ({
    period: row.period,
    created_at: toIsoTimestamp(row.created_at),
    edited_manually: Boolean(row.edited_manually)
  }));
}

async function getRecentSummaries(userId, type, limit = 5) {
  const normalizedUserId = validateUserId(userId);
  const normalizedType = validateSummaryType(type);
  const normalizedLimit = Math.max(1, Number(limit) || 1);

  logNeon("getRecentSummaries", {
    userId: normalizedUserId,
    type: normalizedType,
    limit: normalizedLimit
  });

  const result = await query(
    `SELECT content
     FROM summaries
     WHERE user_id = $1 AND type = $2
     ORDER BY period DESC
     LIMIT $3`,
    [normalizedUserId, normalizedType, normalizedLimit]
  );

  return result.rows.map((row) => String(row.content || "").trim()).filter(Boolean);
}

async function appendToThread(userId, date, text) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateThreadDate(date);
  const normalizedText = String(text || "").trim();

  if (!normalizedText) {
    return getThread(normalizedUserId, normalizedDate);
  }

  logNeon("appendToThread", {
    userId: normalizedUserId,
    date: normalizedDate
  });

  await query(
    `INSERT INTO threads (user_id, date, content, archived, updated_at)
     VALUES ($1, $2, $3, false, now())
     ON CONFLICT (user_id, date)
     DO UPDATE SET
       content = CASE
         WHEN threads.content = '' THEN EXCLUDED.content
         ELSE threads.content || E'\n' || EXCLUDED.content
       END,
       archived = false,
       updated_at = now()`,
    [normalizedUserId, normalizedDate, normalizedText]
  );

  return getThread(normalizedUserId, normalizedDate);
}

async function getThread(userId, date) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateThreadDate(date);

  logNeon("getThread", { userId: normalizedUserId, date: normalizedDate });
  const result = await query(
    `SELECT content
     FROM threads
     WHERE user_id = $1 AND date = $2`,
    [normalizedUserId, normalizedDate]
  );

  if (!result.rows.length) {
    return null;
  }

  return String(result.rows[0].content || "") || null;
}

async function archiveThread(userId, date) {
  const normalizedUserId = validateUserId(userId);
  const normalizedDate = validateThreadDate(date);

  logNeon("archiveThread", { userId: normalizedUserId, date: normalizedDate });
  await query(
    `UPDATE threads
     SET archived = true, updated_at = now()
     WHERE user_id = $1 AND date = $2`,
    [normalizedUserId, normalizedDate]
  );
}

function normalizeDateBoundary(value, mode) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const boundary = new Date(`${normalized}T00:00:00.000Z`);

    if (mode === "end") {
      boundary.setUTCDate(boundary.getUTCDate() + 1);
    }

    return boundary.toISOString();
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function logApiCall(data = {}) {
  try {
    const userId = validateUserId(data.userId);
    const sessionId = textOrNull(data.sessionId);
    const source = String(data.source || "").trim() || "unknown";
    const label = String(data.label || "").trim() || "unlabeled";
    const model = String(data.model || "").trim() || "unknown";
    const metadata = isPlainObject(data.metadata) ? data.metadata : null;

    await query(
      `INSERT INTO ai_request_logs (
        user_id, session_id, source, label, model, input_text, output_text,
        input_tokens, output_tokens, cached_tokens, total_tokens,
        estimated_cost_usd, latency_ms, success, error_message, truncated_at, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17::jsonb
      )`,
      [
        userId,
        sessionId,
        source,
        label,
        model,
        textOrNull(data.inputText),
        textOrNull(data.outputText),
        numberOrZero(data.inputTokens),
        numberOrZero(data.outputTokens),
        numberOrZero(data.cachedTokens),
        numberOrZero(data.totalTokens),
        Number.isFinite(Number(data.estimatedCostUsd)) ? Number(data.estimatedCostUsd).toFixed(6) : "0.000000",
        data.latencyMs === null || data.latencyMs === undefined ? null : Number(data.latencyMs),
        data.success !== false,
        textOrNull(data.errorMessage),
        data.truncatedAt ? timestampOrNow(data.truncatedAt) : null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );

    logDevLogs("logApiCall", {
      userId,
      source,
      label,
      model,
      success: data.success !== false
    });
  } catch (error) {
    console.error("[Dev Logs] logApiCall failed", error);
  }
}

async function getApiLogs(userId, filters = {}) {
  const normalizedUserId = validateUserId(userId);
  const where = ["user_id = $1"];
  const params = [normalizedUserId];

  if (String(filters.source || "").trim()) {
    params.push(String(filters.source).trim());
    where.push(`source = $${params.length}`);
  }

  if (String(filters.model || "").trim()) {
    params.push(String(filters.model).trim());
    where.push(`model = $${params.length}`);
  }

  if (filters.successOnly === true) {
    where.push("success = true");
  }

  if (filters.errorsOnly === true) {
    where.push("success = false");
  }

  const startDate = normalizeDateBoundary(filters.startDate, "start");
  if (startDate) {
    params.push(startDate);
    where.push(`created_at >= $${params.length}::timestamptz`);
  }

  const endDate = normalizeDateBoundary(filters.endDate, "end");
  if (endDate) {
    params.push(endDate);
    where.push(`created_at < $${params.length}::timestamptz`);
  }

  if (String(filters.search || "").trim()) {
    params.push(`%${String(filters.search).trim()}%`);
    where.push(`(label ILIKE $${params.length} OR COALESCE(output_text, '') ILIKE $${params.length})`);
  }

  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
  const offset = Math.max(0, Number(filters.offset) || 0);
  params.push(limit);
  params.push(offset);

  logDevLogs("getApiLogs", {
    userId: normalizedUserId,
    source: filters.source || null,
    model: filters.model || null,
    successOnly: filters.successOnly === true,
    errorsOnly: filters.errorsOnly === true,
    limit,
    offset
  });

  const result = await query(
    `SELECT *
     FROM ai_request_logs
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  return result.rows.map(aiLogRowToRecord);
}

async function getApiLog(userId, id) {
  const normalizedUserId = validateUserId(userId);
  const normalizedId = String(id || "").trim();

  if (!normalizedId) {
    throw createError("An API log ID is required.", 400);
  }

  logDevLogs("getApiLog", { userId: normalizedUserId, id: normalizedId });

  const result = await query(
    `SELECT *
     FROM ai_request_logs
     WHERE user_id = $1 AND id = $2::uuid`,
    [normalizedUserId, normalizedId]
  );

  return result.rows.length ? aiLogRowToRecord(result.rows[0]) : null;
}

async function getApiLogSummary(userId) {
  const normalizedUserId = validateUserId(userId);

  logDevLogs("getApiLogSummary", { userId: normalizedUserId });

  const totalsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today_calls,
       COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::int AS today_tokens,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::numeric AS today_cost,
       COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last7_calls,
       COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::int AS last7_tokens,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= now() - interval '7 days'), 0)::numeric AS last7_cost,
       COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS last30_calls,
       COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= now() - interval '30 days'), 0)::int AS last30_tokens,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= now() - interval '30 days'), 0)::numeric AS last30_cost,
       COUNT(*)::int AS all_calls,
       COALESCE(SUM(total_tokens), 0)::int AS all_tokens,
       COALESCE(SUM(estimated_cost_usd), 0)::numeric AS all_cost,
       COUNT(*) FILTER (WHERE success = false AND created_at >= date_trunc('day', now()))::int AS today_errors,
       COUNT(*) FILTER (WHERE success = false AND created_at >= now() - interval '7 days')::int AS last7_errors
     FROM ai_request_logs
     WHERE user_id = $1`,
    [normalizedUserId]
  );

  const byModelResult = await query(
    `SELECT model,
            COUNT(*)::int AS calls,
            COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost
     FROM ai_request_logs
     WHERE user_id = $1
     GROUP BY model
     ORDER BY estimated_cost DESC, calls DESC`,
    [normalizedUserId]
  );

  const bySourceResult = await query(
    `SELECT source,
            COUNT(*)::int AS calls,
            COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost
     FROM ai_request_logs
     WHERE user_id = $1
     GROUP BY source
     ORDER BY estimated_cost DESC, calls DESC`,
    [normalizedUserId]
  );

  const row = totalsResult.rows[0] || {};
  const mapAggregateRow = (callsKey, tokenKey, costKey) => ({
    calls: numberOrZero(row[callsKey]),
    totalTokens: numberOrZero(row[tokenKey]),
    estimatedCost: Number(row[costKey] || 0)
  });

  return {
    today: mapAggregateRow("today_calls", "today_tokens", "today_cost"),
    last7Days: mapAggregateRow("last7_calls", "last7_tokens", "last7_cost"),
    last30Days: mapAggregateRow("last30_calls", "last30_tokens", "last30_cost"),
    allTime: mapAggregateRow("all_calls", "all_tokens", "all_cost"),
    byModel: byModelResult.rows.map((entry) => ({
      model: entry.model,
      calls: numberOrZero(entry.calls),
      totalTokens: numberOrZero(entry.total_tokens),
      estimatedCost: Number(entry.estimated_cost || 0)
    })),
    bySource: bySourceResult.rows.map((entry) => ({
      source: entry.source,
      calls: numberOrZero(entry.calls),
      totalTokens: numberOrZero(entry.total_tokens),
      estimatedCost: Number(entry.estimated_cost || 0)
    })),
    errorCount: {
      today: numberOrZero(row.today_errors),
      last7Days: numberOrZero(row.last7_errors)
    }
  };
}

async function truncateOldLogs(userId, daysToKeep = 30) {
  const normalizedUserId = validateUserId(userId);
  const safeDaysToKeep = Math.max(1, Number(daysToKeep) || 30);
  const cutoff = new Date(Date.now() - safeDaysToKeep * 24 * 60 * 60 * 1000).toISOString();

  logDevLogs("truncateOldLogs", {
    userId: normalizedUserId,
    daysToKeep: safeDaysToKeep,
    cutoff
  });

  const result = await query(
    `UPDATE ai_request_logs
     SET
       input_text = NULL,
       output_text = NULL,
       truncated_at = now()
     WHERE user_id = $1
       AND created_at < $2::timestamptz
       AND (input_text IS NOT NULL OR output_text IS NOT NULL)
     RETURNING id`,
    [normalizedUserId, cutoff]
  );

  return result.rowCount || 0;
}

async function getRecurringSchedules(userId) {
  const normalizedUserId = validateUserId(userId);

  logNeon("getRecurringSchedules", { userId: normalizedUserId });
  const result = await query(
    `SELECT id, title, category, days_of_week, start_time, end_time, location, drain_level, flexibility, notes
     FROM recurring_schedules
     WHERE user_id = $1 AND active = true
     ORDER BY start_time ASC NULLS LAST`,
    [normalizedUserId]
  );

  return result.rows.map(recurringScheduleRowToContext).filter(Boolean);
}

async function getUpcomingCalendarEvents(userId, fromDate, toDate) {
  const normalizedUserId = validateUserId(userId);
  const normalizedFromDate = validateDate(fromDate, "fromDate");
  const normalizedToDate = validateDate(toDate, "toDate");

  logNeon("getUpcomingCalendarEvents", {
    userId: normalizedUserId,
    fromDate: normalizedFromDate,
    toDate: normalizedToDate
  });
  const result = await query(
    `SELECT title, start_time, end_time, all_day, location, description
     FROM calendar_events
     WHERE user_id = $1
       AND include_health_ctx = true
       AND (
         start_time::date BETWEEN $2::date AND $3::date
         OR (all_day = true AND start_time::date BETWEEN $2::date AND $3::date)
       )
     ORDER BY start_time ASC
     LIMIT 50`,
    [normalizedUserId, normalizedFromDate, normalizedToDate]
  );

  return result.rows.map(calendarEventRowToContext).filter(Boolean);
}

async function comparePeriods(userId, period1Start, period1End, period2Start, period2End) {
  const normalizedUserId = validateUserId(userId);
  const normalizedPeriod1Start = validateDate(period1Start, "period1Start");
  const normalizedPeriod1End = validateDate(period1End, "period1End");
  const normalizedPeriod2Start = validateDate(period2Start, "period2Start");
  const normalizedPeriod2End = validateDate(period2End, "period2End");

  logNeon("comparePeriods", {
    userId: normalizedUserId,
    period1Start: normalizedPeriod1Start,
    period1End: normalizedPeriod1End,
    period2Start: normalizedPeriod2Start,
    period2End: normalizedPeriod2End
  });

  const [period1Logs, period2Logs] = await Promise.all([
    getDateRange(normalizedUserId, normalizedPeriod1Start, normalizedPeriod1End),
    getDateRange(normalizedUserId, normalizedPeriod2Start, normalizedPeriod2End)
  ]);

  return {
    userId: normalizedUserId,
    period1: {
      startDate: normalizedPeriod1Start,
      endDate: normalizedPeriod1End,
      averages: computeAverages(period1Logs)
    },
    period2: {
      startDate: normalizedPeriod2Start,
      endDate: normalizedPeriod2End,
      averages: computeAverages(period2Logs)
    }
  };
}

module.exports = {
  pool,
  initSchema,
  getMemoryFile,
  getMemoryFileRecord,
  saveMemoryFile,
  archiveMemoryFile,
  getMemoryFileArchives,
  getUserList,
  saveUserList,
  getVisitedPages,
  markPageVisited,
  saveSummary,
  getSummary,
  listSummaries,
  getRecentSummaries,
  appendToThread,
  getThread,
  archiveThread,
  logApiCall,
  getApiLogs,
  getApiLog,
  getApiLogSummary,
  truncateOldLogs,
  getRecurringSchedules,
  getUpcomingCalendarEvents,
  getLog,
  updateLog,
  replaceDailyLog,
  getDateRange,
  getMonthlyAverages,
  getFlareDays,
  getGoodDays,
  getSupplementHistory,
  getBestDays,
  getWorstDays,
  comparePeriods,
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
  updateDoctorVisit,
  getDoctorVisits,
  getDoctorVisit,
  deleteDoctorVisit
};
