const { pool } = require("./neon");

function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function logSchedules(operation, details) {
  if (details) {
    console.log(`[Schedules] ${operation}`, details);
    return;
  }

  console.log(`[Schedules] ${operation}`);
}

function textOrNull(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

const RECURRING_DAYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
]);

function normalizeClockTime(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{2}):(\d{2})$/);

  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw createError("Schedule times must use HH:MM format.", 400);
  }

  return normalized;
}

function clockMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeRecurringScheduleInput(data = {}) {
  const title = String(data.title || "").trim();
  const daysOfWeek = [...new Set(
    arrayOrEmpty(data.daysOfWeek)
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => RECURRING_DAYS.has(item))
  )];
  const startTime = normalizeClockTime(data.startTime);
  const endTime = normalizeClockTime(data.endTime);

  if (!title) {
    throw createError("A recurring schedule title is required.", 400);
  }

  if (!daysOfWeek.length) {
    throw createError("Choose at least one day for the recurring schedule.", 400);
  }

  if (Boolean(startTime) !== Boolean(endTime)) {
    throw createError("Add both a start and end time, or mark the block as flexible.", 400);
  }

  if (startTime && clockMinutes(endTime) <= clockMinutes(startTime)) {
    throw createError("End time must be later than start time for a same-day block.", 400);
  }

  return {
    title,
    category: textOrNull(data.category),
    daysOfWeek,
    startTime,
    endTime,
    location: textOrNull(data.location),
    drainLevel: textOrNull(data.drainLevel),
    flexibility: textOrNull(data.flexibility),
    active: data.active !== false,
    notes: textOrNull(data.notes)
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
      // ignore rollback errors
    }

    throw error.statusCode ? error : createError(error.message, 500);
  } finally {
    client.release();
  }
}

function rowToRecurringSchedule(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    category: textOrNull(row.category),
    daysOfWeek: arrayOrEmpty(row.days_of_week),
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : null,
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : null,
    location: textOrNull(row.location),
    drainLevel: textOrNull(row.drain_level),
    flexibility: textOrNull(row.flexibility),
    active: Boolean(row.active),
    notes: textOrNull(row.notes),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function rowToPlanningPreferences(row) {
  return {
    prioritizeRecoveryWhenSymptomsElevated: Boolean(
      row?.prioritize_recovery_when_symptoms_elevated ?? true
    ),
    preferWorkoutTime: row?.prefer_workout_time || "no_preference",
    preferTaskTypeFirst: row?.prefer_task_type_first || "no_preference",
    leaveBufferAfterWork: Boolean(row?.leave_buffer_after_work ?? true),
    defaultBufferMins: Number(row?.default_buffer_mins ?? 30),
    avoidIntenseExerciseAfterPoorSleep: Boolean(
      row?.avoid_intense_exercise_after_poor_sleep ?? true
    ),
    preferLighterDaysAfterHighDrainDays: Boolean(
      row?.prefer_lighter_days_after_high_drain_days ?? true
    ),
    notes: textOrNull(row?.notes),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function rowToCalendarEvent(row) {
  return {
    id: row.id,
    googleEventId: row.google_event_id,
    calendarId: textOrNull(row.calendar_id),
    calendarName: textOrNull(row.calendar_name),
    title: row.title,
    startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    endTime: row.end_time ? new Date(row.end_time).toISOString() : null,
    allDay: Boolean(row.all_day),
    location: textOrNull(row.location),
    description: textOrNull(row.description),
    includePlanning: Boolean(row.include_planning),
    includeHealthContext: Boolean(row.include_health_ctx),
    includeMorningBrief: Boolean(row.include_morning_brief),
    lastSynced: row.last_synced ? new Date(row.last_synced).toISOString() : null
  };
}

async function getGoogleConnection(userId) {
  const result = await query(
    `SELECT * FROM google_connections WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function upsertGoogleConnection(userId, connection) {
  logSchedules("upsertGoogleConnection", { userId });
  const result = await query(
    `INSERT INTO google_connections (
      user_id, access_token, refresh_token, scope, token_type, expiry_date, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, now())
    ON CONFLICT (user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, google_connections.refresh_token),
      scope = EXCLUDED.scope,
      token_type = EXCLUDED.token_type,
      expiry_date = EXCLUDED.expiry_date,
      updated_at = now()
    RETURNING *`,
    [
      userId,
      connection.accessToken,
      connection.refreshToken || null,
      connection.scope || null,
      connection.tokenType || null,
      connection.expiryDate || null
    ]
  );

  return result.rows[0];
}

async function deleteGoogleConnection(userId) {
  logSchedules("deleteGoogleConnection", { userId });
  await query(`DELETE FROM google_connections WHERE user_id = $1`, [userId]);
}

async function getRecurringSchedules(userId) {
  const result = await query(
    `SELECT * FROM recurring_schedules
     WHERE user_id = $1
     ORDER BY active DESC, start_time ASC NULLS LAST, title ASC`,
    [userId]
  );

  return result.rows.map(rowToRecurringSchedule);
}

async function createRecurringSchedule(userId, data) {
  const normalized = normalizeRecurringScheduleInput(data);
  logSchedules("createRecurringSchedule", { userId, title: normalized.title });
  const result = await query(
    `INSERT INTO recurring_schedules (
      user_id, title, category, days_of_week, start_time, end_time, location,
      drain_level, flexibility, active, notes, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
    RETURNING *`,
    [
      userId,
      normalized.title,
      normalized.category,
      normalized.daysOfWeek,
      normalized.startTime,
      normalized.endTime,
      normalized.location,
      normalized.drainLevel,
      normalized.flexibility,
      normalized.active,
      normalized.notes
    ]
  );

  return rowToRecurringSchedule(result.rows[0]);
}

async function updateRecurringSchedule(userId, id, data) {
  const normalized = normalizeRecurringScheduleInput(data);
  logSchedules("updateRecurringSchedule", { userId, id });
  const result = await query(
    `UPDATE recurring_schedules
     SET title = $3,
         category = $4,
         days_of_week = $5,
         start_time = $6,
         end_time = $7,
         location = $8,
         drain_level = $9,
         flexibility = $10,
         active = $11,
         notes = $12,
         updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING *`,
    [
      userId,
      id,
      normalized.title,
      normalized.category,
      normalized.daysOfWeek,
      normalized.startTime,
      normalized.endTime,
      normalized.location,
      normalized.drainLevel,
      normalized.flexibility,
      normalized.active,
      normalized.notes
    ]
  );

  if (!result.rows.length) {
    throw createError("Schedule not found.", 404);
  }

  return rowToRecurringSchedule(result.rows[0]);
}

async function deleteRecurringSchedule(userId, id) {
  logSchedules("deleteRecurringSchedule", { userId, id });
  await query(`DELETE FROM recurring_schedules WHERE user_id = $1 AND id = $2`, [userId, id]);
}

async function getPlanningPreferences(userId) {
  const result = await query(
    `SELECT * FROM planning_preferences WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    return rowToPlanningPreferences({});
  }

  return rowToPlanningPreferences(result.rows[0]);
}

async function upsertPlanningPreferences(userId, data) {
  logSchedules("upsertPlanningPreferences", { userId });
  const result = await query(
    `INSERT INTO planning_preferences (
      user_id,
      prioritize_recovery_when_symptoms_elevated,
      prefer_workout_time,
      prefer_task_type_first,
      leave_buffer_after_work,
      default_buffer_mins,
      avoid_intense_exercise_after_poor_sleep,
      prefer_lighter_days_after_high_drain_days,
      notes,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (user_id) DO UPDATE SET
      prioritize_recovery_when_symptoms_elevated = EXCLUDED.prioritize_recovery_when_symptoms_elevated,
      prefer_workout_time = EXCLUDED.prefer_workout_time,
      prefer_task_type_first = EXCLUDED.prefer_task_type_first,
      leave_buffer_after_work = EXCLUDED.leave_buffer_after_work,
      default_buffer_mins = EXCLUDED.default_buffer_mins,
      avoid_intense_exercise_after_poor_sleep = EXCLUDED.avoid_intense_exercise_after_poor_sleep,
      prefer_lighter_days_after_high_drain_days = EXCLUDED.prefer_lighter_days_after_high_drain_days,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING *`,
    [
      userId,
      data?.prioritizeRecoveryWhenSymptomsElevated !== false,
      data?.preferWorkoutTime || "no_preference",
      data?.preferTaskTypeFirst || "no_preference",
      data?.leaveBufferAfterWork !== false,
      Number(data?.defaultBufferMins) || 30,
      data?.avoidIntenseExerciseAfterPoorSleep !== false,
      data?.preferLighterDaysAfterHighDrainDays !== false,
      textOrNull(data?.notes)
    ]
  );

  return rowToPlanningPreferences(result.rows[0]);
}

async function replaceCalendarEvents(userId, events) {
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM calendar_events WHERE user_id = $1`, [userId]);

    for (const event of arrayOrEmpty(events)) {
      await client.query(
        `INSERT INTO calendar_events (
          user_id, google_event_id, calendar_id, calendar_name, title, start_time, end_time,
          all_day, location, description, include_planning, include_health_ctx, include_morning_brief,
          last_synced, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()
        )`,
        [
          userId,
          event.googleEventId,
          textOrNull(event.calendarId),
          textOrNull(event.calendarName),
          event.title,
          event.startTime || null,
          event.endTime || null,
          Boolean(event.allDay),
          textOrNull(event.location),
          textOrNull(event.description),
          event.includePlanning !== false,
          event.includeHealthContext !== false,
          event.includeMorningBrief !== false,
          event.lastSynced || new Date().toISOString()
        ]
      );
    }
  });
}

async function getCalendarEvents(userId) {
  const result = await query(
    `SELECT * FROM calendar_events
     WHERE user_id = $1
     ORDER BY start_time ASC NULLS LAST, title ASC`,
    [userId]
  );

  return result.rows.map(rowToCalendarEvent);
}

module.exports = {
  normalizeRecurringScheduleInput,
  getGoogleConnection,
  upsertGoogleConnection,
  deleteGoogleConnection,
  getRecurringSchedules,
  createRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  getPlanningPreferences,
  upsertPlanningPreferences,
  replaceCalendarEvents,
  getCalendarEvents
};
