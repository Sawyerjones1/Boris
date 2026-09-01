const fs = require("fs");
const path = require("path");
const {
  pool,
  initSchema,
  replaceDailyLog,
  saveMemoryFile,
  saveSummary,
  saveSupplement,
  savePrescription,
  logApiCall
} = require("../core/neon");
const { createRecurringSchedule, upsertPlanningPreferences } = require("../core/schedules");
const { ensureDefaultMorningBrief } = require("../core/automations");
const { appendToThread } = require("../core/chat");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const DEMO_USER_ID = "portfolio-demo";
const DAY_COUNT = 120;

function addDays(date, offset) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + offset);
  return next.toISOString().slice(0, 10);
}

function getDemoEndDate() {
  const configured = String(process.env.DEMO_END_DATE || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(configured)
    ? configured
    : new Date().toISOString().slice(0, 10);
}

function meal(description, time, calories, protein, carbs, fat) {
  return { description, time, macros: { calories, protein, carbs, fat } };
}

function isoWeek(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function average(values) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(1));
}

function presentSymptomNames(log) {
  return (Array.isArray(log.symptoms) ? log.symptoms : [])
    .filter((entry) => entry?.present)
    .map((entry) => entry.name);
}

// Story: Jordan Reyes, a software engineer, caught COVID about 5.5 months before
// DAY_COUNT's last day and never fully bounced back. Lingering post-viral symptoms
// (fatigue, bloating, anxiety, headache, brain fog) come and go without one clean
// trigger. Jordan uses Boris to find their own patterns across sleep, exertion,
// stress, and hydration, and to track whether pacing + Lexapro (started partway
// through) are helping. This is a recovery story, not a resolution story: more
// good days than bad by the end, but not symptom-free.
//
// Phases (index into the DAY_COUNT-length log window, day 0 = earliest):
//   0-33   EARLY    - closest to acute illness. Frequent, severe flares. Still
//                     learning what to log. No deliberate pacing yet.
//   34-77  MIDDLE   - starts deliberately pacing exertion, prioritizing sleep and
//                     hydration. Lexapro starts around day 42. Recurring schedule
//                     shifts (an intense workout block gets replaced by an easier
//                     one) around day 50.
//   78-119 LATE     - clearly more good days than bad. Brain fog and headaches
//                     ease fastest; fatigue lags, which is realistic for post-viral
//                     recovery. Occasional flares still happen, usually after a
//                     poor-sleep or high-exertion day.
const LEXAPRO_START_INDEX = 42;
const SCHEDULE_SHIFT_INDEX = 50;

function getPhase(index) {
  if (index < 34) return "early";
  if (index < 78) return "middle";
  return "late";
}

function demoLog(date, index) {
  const phase = getPhase(index);

  // Candidate bad-day factors. None is a guaranteed trigger on its own - that's
  // the point of the story - but they compound. Frequency and severity of flares
  // fall as the phase progresses.
  const poorSleep = phase === "early" ? index % 3 === 0 : phase === "middle" ? index % 5 === 0 : index % 9 === 0;
  const overexertion = phase === "early"
    ? index % 6 === 2
    : phase === "middle"
      ? (index % 8 === 5 && index >= SCHEDULE_SHIFT_INDEX ? false : index % 8 === 5)
      : index % 15 === 7;
  const poorHydration = index % 4 === 3 && phase !== "late";
  const highStressWorkday = index % 7 === 5;

  const badDayScore = [poorSleep, overexertion, poorHydration, highStressWorkday]
    .filter(Boolean).length;
  const flareThreshold = phase === "early" ? 1 : phase === "middle" ? 2 : 3;
  const flareDay = badDayScore >= flareThreshold;
  const goodDay = badDayScore === 0 && !flareDay;

  const onLexapro = index >= LEXAPRO_START_INDEX;

  // Brain fog and headache track flares closely but fade fastest in late phase.
  // Fatigue lags behind - still shows up on good-ish days in middle/late phase,
  // just less severely. Anxiety softens somewhat after Lexapro takes hold
  // (roughly 3-4 weeks after starting, consistent with real onset time).
  const anxietyEasing = onLexapro && index >= LEXAPRO_START_INDEX + 24;
  const brainFogRoll = (index * 37 + 11) % 100;
  const symptomActive = {
    Fatigue: flareDay || (phase !== "late" && badDayScore >= 1) || (phase === "late" && index % 4 === 0),
    Bloating: flareDay || (poorHydration && badDayScore >= 1),
    Anxiety: highStressWorkday && !(anxietyEasing && index % 3 !== 0),
    Headache: flareDay && phase !== "late",
    "Brain fog": flareDay && (phase === "early" || brainFogRoll > 50)
  };

  const sleepHours = Number((poorSleep
    ? 5.3 + (index % 5) / 10
    : 7.0 + (index % 6) / 10).toFixed(1));
  const sleepQuality = poorSleep ? 3 : flareDay ? 5 : 7;
  const energyBase = flareDay ? 3 : goodDay ? 8 : 6;
  const eveningDrop = flareDay ? 1 : 0;

  const highExertionMeal = ["burrito bowl with extra rice", "burger and fries", "pad thai", "large pasta dinner"][index % 4];
  const meals = overexertion
    ? [
        meal("scrambled eggs and toast", "07:30", 380, 20, 32, 16),
        meal(highExertionMeal, "12:30", 720, 30, 88, 26),
        meal("grilled chicken, sweet potato, broccoli", "19:00", 610, 44, 52, 18)
      ]
    : [
        meal("oatmeal with peanut butter and banana", "08:00", 420, 16, 58, 14),
        meal("turkey and avocado wrap with side salad", "12:30", 560, 32, 48, 22),
        meal("salmon, rice, and roasted vegetables", "18:30", 590, 38, 50, 20)
      ];

  const supplementsTaken = [
    { name: "Multivitamin", taken: true, time: "08:00" },
    { name: "Fish oil", taken: true, time: "08:00" },
    { name: "Magnesium glycinate", taken: true, time: "21:30" },
    { name: "Creatine", taken: !flareDay || index % 2 === 0, time: "08:00" },
    { name: "Electrolytes", taken: overexertion || poorHydration || index % 2 === 0, time: "10:00" }
  ];
  if (onLexapro) {
    supplementsTaken.push({ name: "Lexapro (escitalopram)", taken: true, time: "08:00" });
  }

  const whatChangedByPhase = {
    early: index % 10 === 0
      ? "Still trying to figure out what actually makes a difference day to day."
      : "",
    middle: index === LEXAPRO_START_INDEX
      ? "Started Lexapro today per Dr. Patel - tracking mood and energy closely over the next few weeks."
      : index === SCHEDULE_SHIFT_INDEX
        ? "Swapped the intense HIIT block for an easier mobility/walk block - trying to stop overdoing it and crashing the next day."
        : overexertion
          ? "Pushed harder than planned today - testing whether pacing actually matters or if this was a fluke."
          : poorHydration
            ? "Definitely under-hydrated today, want to see if that's a real factor."
            : "",
    late: goodDay && index % 6 === 0
      ? "Good, steady day - sticking to the sleep window and easier morning movement seems to be paying off."
      : ""
  };

  const journalNote = flareDay
    ? phase === "early"
      ? "Rough day. Wiped out by early afternoon, hard to focus, stomach off most of the day."
      : "Flare day - pushed too hard or slept badly the night before. Frustrating but at least I can see why now."
    : goodDay
      ? "Genuinely good day. Slept well, paced myself, felt close to normal."
      : "Mixed day - not a flare, but not 100% either.";

  return {
    date,
    lastUpdated: `${date}T21:00:00.000Z`,
    vitals: {
      sleep: { hours: sleepHours, quality: sleepQuality },
      energy: { morning: energyBase, evening: Math.max(2, energyBase - eveningDrop) },
      mood: flareDay ? 4 : goodDay ? 8 : 6,
      stress: highStressWorkday ? 7 : flareDay ? 6 : 4,
      goodDay,
      hrv: poorSleep ? 38 : flareDay ? 44 : 56,
      restingHR: poorSleep ? 74 : flareDay ? 70 : 61
    },
    vitalsReadings: index % 10 === 0
      ? [{ id: `weight-${date}`, type: "weight", time: "07:30", value: 158.2, unit: "lb", note: "Morning reading" }]
      : [],
    supplements: supplementsTaken,
    symptoms: Object.entries(symptomActive).map(([name, present]) => ({
      name,
      present,
      time: present ? "15:00" : null
    })),
    intake: {
      meals,
      caffeine: poorSleep ? "2 coffees" : "1 coffee",
      alcohol: index % 12 === 0 ? "1 drink" : "none",
      water: poorHydration ? "Low" : overexertion ? "Okay" : "Good"
    },
    exercise: overexertion
      ? [{ description: index >= SCHEDULE_SHIFT_INDEX ? "Longer hike, pushed pace" : "HIIT class", type: "high-intensity", duration: 55, time: "17:30", feeling: 4 }]
      : index % 3 === 0
        ? [{ description: index >= SCHEDULE_SHIFT_INDEX ? "Easy walk / mobility work" : "Light jog", type: index >= SCHEDULE_SHIFT_INDEX ? "walking" : "running", duration: 30, time: "17:30", feeling: goodDay ? 8 : 6 }]
        : [],
    flareDay,
    whatChanged: whatChangedByPhase[phase],
    journalEntries: [{ id: `journal-${date}`, time: flareDay ? "15:30" : "20:00", note: journalNote }],
    weather: null
  };
}

// Mirrors DAILY_SUMMARY_PROMPT in core/scheduler.js: 2-4 sentences, interpretation
// and causal connections only (never a restated recap of sleep hours, supplements,
// meals, or exercise, since that structured data already lives in daily_logs),
// past tense, clinical note style. Built directly from demoLog's own fields so it
// stays consistent with whatever a given day's log actually contains.
function buildDailySummary(log, index, previousLog) {
  const phase = getPhase(index);
  const symptoms = presentSymptomNames(log);
  const sleepHours = log.vitals.sleep.hours;
  const prevExercise = Array.isArray(previousLog?.exercise) ? previousLog.exercise : [];
  const hadHardExerciseYesterday = prevExercise.some((entry) => entry.type === "high-intensity");
  const onLexapro = index >= LEXAPRO_START_INDEX;

  if (log.flareDay) {
    const causes = [];
    if (sleepHours < 6) causes.push(`only ${sleepHours} hours of sleep`);
    if (hadHardExerciseYesterday) causes.push("yesterday's high-intensity session");
    if (log.intake.water === "Low") causes.push("low hydration");
    if (log.vitals.stress >= 7) causes.push("a high-stress workday");
    const causeText = causes.length
      ? `Likely driven by ${causes.join(" combined with ")}.`
      : "No single clear driver stood out, consistent with how these flares have behaved throughout tracking.";
    const symptomText = symptoms.length ? `${symptoms.join(", ")} were most prominent.` : "";
    return [
      `Flare day. ${causeText}`,
      symptomText,
      `HRV was reduced (${log.vitals.hrv}) relative to typical non-flare days, in line with the pattern of poor recovery preceding these days.`
    ].filter(Boolean).join(" ");
  }

  if (log.vitals.goodDay) {
    if (phase === "late") {
      return `Good day, consistent with the pattern seen since pacing and sleep changes took hold: ${sleepHours} hours of sleep, no prior-day high-intensity exertion, and stable mood/energy throughout.${onLexapro && log.vitals.stress <= 4 ? " No anxiety despite the workweek, which continues to track with starting Lexapro." : ""}`;
    }
    return `Good day. Slept ${sleepHours} hours and paced activity; no notable symptoms broke through today.`;
  }

  if (symptoms.length) {
    return `Mixed day, not a full flare. ${symptoms.join(", ")} present but manageable. Sleep (${sleepHours}h) was on the lower end without crossing into flare territory, which fits the graded relationship between sleep debt and symptom severity seen elsewhere in the record.`;
  }

  return `Unremarkable day. No symptoms logged and vitals stayed near baseline; nothing here changes the emerging pattern.`;
}

// Mirrors the weekly instructions in generateWeeklySummary (core/scheduler.js):
// Overview, per-metric Averages (with "insufficient data" under 3 days), Symptoms,
// Supplements/Medications adherence, Exercise, Notable patterns, Flare days.
function buildWeeklySummary(weekLabel, weekLogs, stage) {
  const daysLogged = weekLogs.length;
  const sleepAvg = average(weekLogs.map((log) => log.vitals.sleep.hours));
  const moodAvg = average(weekLogs.map((log) => log.vitals.mood));
  const stressAvg = average(weekLogs.map((log) => log.vitals.stress));
  const energyAvg = average(weekLogs.map((log) => (log.vitals.energy.morning + log.vitals.energy.evening) / 2));
  const hrvAvg = average(weekLogs.map((log) => log.vitals.hrv));

  const flareCount = weekLogs.filter((log) => log.flareDay).length;
  const goodDayCount = weekLogs.filter((log) => log.vitals.goodDay).length;

  const symptomCounts = new Map();
  for (const log of weekLogs) {
    for (const name of presentSymptomNames(log)) {
      symptomCounts.set(name, (symptomCounts.get(name) || 0) + 1);
    }
  }
  const topSymptoms = [...symptomCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count}/${daysLogged} days)`);

  const supplementNames = ["Multivitamin", "Fish oil", "Magnesium glycinate", "Creatine", "Electrolytes"];
  const onLexapro = weekLogs.some((log) => log.supplements.some((item) => item.name.startsWith("Lexapro")));
  const adherenceLines = supplementNames.map((name) => {
    const takenCount = weekLogs.filter((log) => log.supplements.some((item) => item.name === name && item.taken)).length;
    return `${name} ${takenCount}/${daysLogged} days`;
  });
  if (onLexapro) {
    const takenCount = weekLogs.filter((log) => log.supplements.some((item) => item.name.startsWith("Lexapro") && item.taken)).length;
    adherenceLines.push(`Lexapro (escitalopram) ${takenCount}/${daysLogged} days`);
  }

  const exerciseSessions = weekLogs.flatMap((log) => log.exercise);
  const exerciseTypes = [...new Set(exerciseSessions.map((entry) => entry.description))];

  const flareCommonality = stage === "early"
    ? "Flares this week showed no consistent single cause yet - still gathering enough data to separate sleep, exertion, and stress as distinct factors."
    : flareCount
      ? "Flare days this week continued to follow short sleep, harder exertion the day before, high-stress workdays, or low hydration - usually more than one factor at once."
      : "No flare days this week.";

  const patternLine = stage === "early"
    ? "Overview: Early in tracking. Symptoms remain frequent and the person is still learning what to log consistently."
    : stage === "middle"
      ? "Overview: Deliberately pacing exertion and prioritizing sleep this week; noticeably fewer flares than earlier weeks."
      : "Overview: Good days outnumbered flare days this week, consistent with the trend over the past several weeks.";

  return [
    `${patternLine} ${daysLogged}/7 days logged.`,
    "",
    "Averages:",
    `- Sleep: ${sleepAvg !== null ? `${sleepAvg} hours` : "insufficient data"}`,
    `- Mood: ${moodAvg !== null ? `${moodAvg}/10` : "insufficient data"}`,
    `- Stress: ${stressAvg !== null ? `${stressAvg}/10` : "insufficient data"}`,
    `- Energy: ${energyAvg !== null ? `${energyAvg}/10` : "insufficient data"}`,
    `- HRV: ${hrvAvg !== null ? hrvAvg : "insufficient data"}`,
    "",
    `Symptoms: ${topSymptoms.length ? topSymptoms.join(", ") : "No symptoms logged this week."}`,
    "",
    `Supplements and Medications: ${adherenceLines.join("; ")}.`,
    "",
    `Exercise: ${exerciseSessions.length} session(s) logged${exerciseTypes.length ? ` (${exerciseTypes.join(", ")})` : ""}.`,
    "",
    `Notable patterns: ${goodDayCount} good day(s), ${flareCount} flare day(s) out of ${daysLogged} logged.`,
    "",
    `Flare days: ${flareCommonality}`
  ].join("\n");
}

// Mirrors the monthly instructions in generateMonthlySummary (core/scheduler.js):
// averages vs prior period, trend observations, notable events/decisions,
// supplement/exercise consistency, symptom frequency and new patterns.
function buildMonthlySummary(monthKey, monthLogs, previousMonthLogs, stage) {
  const sleepAvg = average(monthLogs.map((log) => log.vitals.sleep.hours));
  const moodAvg = average(monthLogs.map((log) => log.vitals.mood));
  const stressAvg = average(monthLogs.map((log) => log.vitals.stress));
  const prevSleepAvg = average((previousMonthLogs || []).map((log) => log.vitals.sleep.hours));
  const prevStressAvg = average((previousMonthLogs || []).map((log) => log.vitals.stress));

  const flareCount = monthLogs.filter((log) => log.flareDay).length;
  const prevFlareCount = (previousMonthLogs || []).filter((log) => log.flareDay).length;

  const symptomCounts = new Map();
  for (const log of monthLogs) {
    for (const name of presentSymptomNames(log)) {
      symptomCounts.set(name, (symptomCounts.get(name) || 0) + 1);
    }
  }
  const topSymptoms = [...symptomCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count} day${count === 1 ? "" : "s"})`);

  const sleepTrend = prevSleepAvg === null || sleepAvg === null
    ? "not comparable to the prior month (insufficient data)"
    : sleepAvg > prevSleepAvg + 0.2
      ? `improved from ${prevSleepAvg}h to ${sleepAvg}h average`
      : sleepAvg < prevSleepAvg - 0.2
        ? `declined from ${prevSleepAvg}h to ${sleepAvg}h average`
        : `held steady around ${sleepAvg}h average`;
  const flareTrend = flareCount < prevFlareCount
    ? `Flare days decreased from ${prevFlareCount} to ${flareCount}.`
    : flareCount > prevFlareCount
      ? `Flare days increased from ${prevFlareCount} to ${flareCount}.`
      : `Flare days held steady at ${flareCount}.`;

  const events = [];
  const lexaproStartsThisMonth = monthLogs.some((log, idx) => log.supplements.some((item) => item.name.startsWith("Lexapro")))
    && !(previousMonthLogs || []).some((log) => log.supplements.some((item) => item.name.startsWith("Lexapro")));
  if (lexaproStartsThisMonth) events.push("Started Lexapro (escitalopram) for anxiety related to prolonged recovery.");
  const scheduleShiftThisMonth = monthLogs.some((log) => (log.whatChanged || "").includes("Swapped the intense HIIT block"));
  if (scheduleShiftThisMonth) events.push("Replaced the recurring high-intensity workout block with lighter morning movement after repeated next-day crashes.");

  const supplementConsistency = ["Multivitamin", "Fish oil", "Magnesium glycinate", "Creatine", "Electrolytes"]
    .map((name) => {
      const takenCount = monthLogs.filter((log) => log.supplements.some((item) => item.name === name && item.taken)).length;
      return `${name} ${Math.round((takenCount / monthLogs.length) * 100)}%`;
    }).join(", ");
  const exerciseSessionCount = monthLogs.flatMap((log) => log.exercise).length;

  const trendNarrative = stage === "early"
    ? "Trend observations: Still early in recovery; symptoms and flares were frequent and no clear risk-factor pattern had emerged yet."
    : stage === "middle"
      ? "Trend observations: A clearer pattern emerged this month - flares track with stacked risk factors (short sleep, hard exertion, high stress, poor hydration) rather than any single trigger."
      : "Trend observations: Good days now outnumber flare days. Brain fog and headache have eased notably; fatigue remains the slowest symptom to improve, consistent with typical post-viral recovery.";

  return [
    `Monthly averages: Sleep ${sleepAvg !== null ? `${sleepAvg}h` : "insufficient data"} (${sleepTrend}). Mood ${moodAvg !== null ? `${moodAvg}/10` : "insufficient data"}. Stress ${stressAvg !== null ? `${stressAvg}/10` : "insufficient data"}${prevStressAvg !== null && stressAvg !== null ? ` (prior month ${prevStressAvg}/10)` : ""}.`,
    "",
    trendNarrative,
    "",
    `Notable events: ${events.length ? events.join(" ") : "No major changes to routine or treatment this month."}`,
    "",
    `Supplement and exercise consistency: ${supplementConsistency}. ${exerciseSessionCount} exercise session(s) logged this month.`,
    "",
    `Symptom frequency: ${topSymptoms.length ? `${topSymptoms.join(", ")}.` : "No symptoms logged this month."} ${flareTrend}`
  ].join("\n");
}

async function clearDemoUser(userId) {
  const tables = [
    "automation_runs", "automations", "visited_pages", "memory_file_archives", "memory_files", "user_lists", "summaries", "threads", "ai_request_logs",
    "calendar_events", "google_connections", "planning_preferences", "recurring_schedules",
    "doctor_visits", "lab_results", "prescriptions", "daily_logs"
  ];

  await pool.query("DELETE FROM supplement_ingredients WHERE supplement_id IN (SELECT id FROM supplements WHERE user_id = $1)", [userId]);
  await pool.query("DELETE FROM supplements WHERE user_id = $1", [userId]);
  for (const table of tables) {
    await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
  }
}

async function seedChatHistory(userId, endDate) {
  // A short, realistic conversation seeded on the most recent day so the chat
  // page shows Boris reasoning over real history instead of an empty thread.
  // Mirrors the actual mode variety: a log-style exchange, a grounded question
  // (Doctor Mode), and a pattern follow-up.
  const exchanges = [
    {
      user: "Rough afternoon today, pretty wiped out and my head's pounding.",
      boris: "Logged as a flare day - noted fatigue and headache. Looking at last night, you got 5.4 hours of sleep and yesterday's workout was the longer hike, so that combination lines up with your usual pattern. Worth an early night tonight."
    },
    {
      user: "Has starting Lexapro actually helped with the anxiety, or am I imagining it?",
      boris: "Not imagining it. In the four weeks before you started Lexapro, high-stress workdays came with logged anxiety almost every time. Since about three and a half weeks after you started, that's dropped to roughly one in three. Everything else being equal, that's a meaningful shift, though your sample size is still limited - worth mentioning at your next follow-up rather than treating it as fully settled."
    },
    {
      user: "What actually seems to predict a good day for me at this point?",
      boris: "Your best days consistently share three things: 7+ hours of sleep, no high-intensity exertion the day before, and good hydration. None of those alone guarantees a good day, but when at least two line up, you're rarely flaring. The mobility/walk block you switched to after the HIIT swap shows up on more good days than the old routine did."
    }
  ];

  for (const exchange of exchanges) {
    await appendToThread(userId, exchange.user, exchange.boris, "log");
  }

  console.log(`Seeded a ${exchanges.length}-exchange chat thread for ${endDate}.`);
}

async function seedDemoData(userId, endDate) {
  const startDate = addDays(endDate, -(DAY_COUNT - 1));
  await clearDemoUser(userId);

  await Promise.all([
    saveMemoryFile(userId, "identity", `# Identity
- Name: Jordan Reyes (fictional portfolio persona)
- DOB: 1994-08-03
- Sex assigned at birth: Male
- Height: 5 ft 10 in
- Home region: Austin, TX

# Communication Preferences
- Be direct and grounded in the logged data. Lead with the answer.
- Distinguish observations from established patterns - don't overstate confidence.
- Use concrete dates and examples when pointing out a pattern.
- Flag when data is limited or confounded by an off week.

# Goals
- Understand what actually predicts a good day versus a flare day.
- Rebuild exertion tolerance without repeatedly triggering a crash.
- Track whether Lexapro and pacing changes are meaningfully helping.
- Have as many good days as possible while accepting recovery isn't linear.`),
    saveMemoryFile(userId, "onboarding", `# Onboarding Snapshot
This document preserves the information submitted for the fictional portfolio persona. It is source context, not a generated medical conclusion.

## Baseline
- Preferred name: Jordan Reyes
- Date of birth: 1994-08-03
- Sex assigned at birth: Male
- Height: 5 ft 10 in
- Weight: 158 lbs
- Home region: Austin, TX

## Daily Context
- Weekday commitments: Software engineer, hybrid schedule, usually 9:00 AM to 5:30 PM with some high-intensity sprint weeks.
- Typical day: Desk work, an attempt at daily movement (varies by energy), dinner at home.
- Food pattern or considerations: Cooks most meals; protein, rice, vegetables; coffee most mornings.

## Health Context
- Reason for tracking: Had COVID about 5.5 months ago and never fully returned to baseline. Trying to find personal patterns behind ongoing symptoms.
- Symptoms to track: Fatigue, bloating, anxiety, headache, brain fog
- Diagnoses or current conditions: Working diagnosis of post-viral syndrome (post-COVID); no other diagnosis
- Allergies or adverse reactions: None known
- Reported factors to monitor: Sleep debt, overexertion, high-stress workdays, and poor hydration each seem to raise the odds of a bad day, but none is a guaranteed trigger on its own - this is a question to keep testing, not a settled answer.
- Recent changes: Started Lexapro (escitalopram) for anxiety; shifted from high-intensity workouts to easier movement to avoid post-exertional crashes.
- Desired outcomes: More good days than bad, and a clear enough picture of triggers to bring to a follow-up visit.

## Care Context
### Medications
- Lexapro (escitalopram) — Dose: 10 mg; Frequency: daily; Timing: morning; Purpose: Anxiety related to prolonged recovery

### Supplements
- Multivitamin — Dose: 1 tablet; Frequency: daily; Timing: morning; Purpose: General nutritional support
- Fish oil — Dose: 1,000 mg; Frequency: daily; Timing: morning; Purpose: General wellness
- Magnesium glycinate — Dose: 200 mg; Frequency: daily; Timing: evening; Purpose: Sleep support
- Creatine — Dose: 5 g; Frequency: daily; Timing: morning; Purpose: Exercise and cognitive support during recovery
- Electrolytes — Dose: 1 packet; Frequency: as needed; Timing: mid-morning; Purpose: Hydration support

- Care team: Dr. Priya Patel, Primary Care, Fictional Austin Family Medicine`),
    saveMemoryFile(userId, "health-picture", `# Current Supplement Stack
## Prescriptions
- Lexapro (escitalopram) — 10 mg each morning, for anxiety related to prolonged post-viral recovery. Started partway through tracking; reported improvement in anxiety on high-stress workdays since roughly four weeks after starting.

## Supplements
- Multivitamin, 1 tablet each morning.
- Fish oil, 1,000 mg each morning.
- Magnesium glycinate, 200 mg each evening.
- Creatine, 5 g most mornings; occasionally skipped on flare days.
- Electrolytes, roughly every other day, more often after exertion or low-hydration days.

# Active Patterns
- This is a fictional portfolio dataset illustrating a post-viral (post-COVID) recovery.
- Flare days most often follow some combination of short sleep (under 6 hours), high-intensity exertion the prior day, high-stress workdays, and poor hydration. No single factor reliably predicts a flare on its own; flares become more likely as these factors stack.
- Brain fog and headache have become less frequent and less severe over the tracked period. Fatigue has improved more slowly and still appears on days that are otherwise good, which is consistent with typical post-viral recovery patterns.
- Anxiety tied to high-stress workdays has been reported less often starting roughly three to four weeks after beginning Lexapro, though the sample size remains limited.
- Switching from high-intensity workouts to lighter movement (walks, mobility work) coincides with fewer next-day flares than the prior routine.
- Good days consistently combine 7+ hours of sleep, no high-intensity exertion the day before, and adequate hydration.

# Lab Picture
- No lab results have been added yet.

# Current Concerns
- Continue structured symptom tracking to distinguish real patterns from noise.
- Fatigue remains the slowest symptom to improve and is the primary ongoing concern.
- Discuss Lexapro response and any follow-up inflammatory labs at the next visit.
- Goal remains maximizing good days while accepting that recovery is gradual and non-linear.`)
  ]);

  // Keep every generated log in memory, in order, so the daily/weekly/monthly
  // summary builders below can consume the exact same data that was written to
  // daily_logs rather than re-deriving it from the demoLog RNG a second time.
  const logsInOrder = [];
  for (let index = 0; index < DAY_COUNT; index += 1) {
    const date = addDays(startDate, index);
    const log = demoLog(date, index);
    logsInOrder.push({ date, index, log });
    await replaceDailyLog(userId, date, log);
  }

  // Daily summaries: mirrors DAILY_SUMMARY_PROMPT (core/scheduler.js) - short
  // interpretive notes, not a recap of the structured log. Real Boris only
  // generates one once a day via cron; here every day gets one so the Notes
  // page's Daily Summaries tab isn't empty across the whole seeded history.
  for (let index = 0; index < DAY_COUNT; index += 1) {
    const { date, log } = logsInOrder[index];
    const previousLog = index > 0 ? logsInOrder[index - 1].log : null;
    await saveSummary(userId, "daily", date, buildDailySummary(log, index, previousLog));
  }

  const weekBuckets = new Map();
  const monthBuckets = new Map();
  for (const { date, log } of logsInOrder) {
    const weekKey = isoWeek(date);
    const monthKey = date.slice(0, 7);
    if (!weekBuckets.has(weekKey)) weekBuckets.set(weekKey, []);
    if (!monthBuckets.has(monthKey)) monthBuckets.set(monthKey, []);
    weekBuckets.get(weekKey).push(log);
    monthBuckets.get(monthKey).push(log);
  }

  // Weekly summaries: mirrors the 7-part structure generateWeeklySummary asks
  // for (Overview / Averages / Symptoms / Supplements & Medications / Exercise /
  // Notable patterns / Flare days), computed from the same logs written above
  // rather than hand-written prose.
  const weekKeys = [...weekBuckets.keys()];
  for (let weekIndex = 0; weekIndex < weekKeys.length; weekIndex += 1) {
    const weekLabel = weekKeys[weekIndex];
    const stage = weekIndex < weekKeys.length / 3 ? "early" : weekIndex < (2 * weekKeys.length) / 3 ? "middle" : "late";
    const summaryText = buildWeeklySummary(weekLabel, weekBuckets.get(weekLabel), stage);
    await saveSummary(userId, "weekly", weekLabel, summaryText, { editedManually: true });
  }

  // Monthly summaries: mirrors generateMonthlySummary's structure (averages vs
  // prior period, trend observations, notable events, supplement/exercise
  // consistency, symptom frequency), also computed from the real seeded logs.
  const monthKeys = [...monthBuckets.keys()];
  for (let monthIndex = 0; monthIndex < monthKeys.length; monthIndex += 1) {
    const monthKey = monthKeys[monthIndex];
    const stage = monthIndex < monthKeys.length / 3 ? "early" : monthIndex < (2 * monthKeys.length) / 3 ? "middle" : "late";
    const previousMonthLogs = monthIndex > 0 ? monthBuckets.get(monthKeys[monthIndex - 1]) : null;
    const summaryText = buildMonthlySummary(monthKey, monthBuckets.get(monthKey), previousMonthLogs, stage);
    await saveSummary(userId, "monthly", monthKey, summaryText, { editedManually: true });
  }

  await savePrescription(userId, {
    date: addDays(endDate, -(DAY_COUNT - LEXAPRO_START_INDEX)),
    source: "Synthetic portfolio record",
    extractedData: {
      medicationName: "Lexapro (escitalopram)",
      dose: "10 mg",
      frequency: "daily",
      timeOfDay: "morning",
      purpose: "Anxiety related to prolonged post-viral recovery",
      active: true
    }
  });
  await saveSupplement(userId, { date: startDate, source: "Synthetic portfolio record", extractedData: { name: "Multivitamin", dose: "1 tablet", frequency: "daily", timeOfDay: "morning", purpose: "General nutritional support", active: true } });
  await saveSupplement(userId, { date: startDate, source: "Synthetic portfolio record", extractedData: { name: "Fish oil", dose: "1,000 mg", frequency: "daily", timeOfDay: "morning", purpose: "General wellness", active: true } });
  await saveSupplement(userId, { date: startDate, source: "Synthetic portfolio record", extractedData: { name: "Magnesium glycinate", dose: "200 mg", frequency: "daily", timeOfDay: "evening", purpose: "Sleep support", active: true } });
  await saveSupplement(userId, { date: startDate, source: "Synthetic portfolio record", extractedData: { name: "Creatine", dose: "5 g", frequency: "daily", timeOfDay: "morning", purpose: "Exercise and cognitive support during recovery", active: true } });
  await saveSupplement(userId, { date: startDate, source: "Synthetic portfolio record", extractedData: { name: "Electrolytes", dose: "1 packet", frequency: "as needed", timeOfDay: "mid-morning", purpose: "Hydration support", active: true } });

  await createRecurringSchedule(userId, {
    title: "Focused work block",
    category: "work",
    daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    startTime: "09:00",
    endTime: "17:30",
    location: "Home / office hybrid",
    drainLevel: "medium",
    flexibility: "low",
    notes: "Fictional demo schedule"
  });
  await createRecurringSchedule(userId, {
    title: "Morning movement (walk / mobility)",
    category: "exercise",
    daysOfWeek: ["monday", "wednesday", "friday", "saturday"],
    startTime: "07:30",
    endTime: "08:15",
    location: "Neighborhood / home",
    drainLevel: "low",
    flexibility: "flexible",
    notes: "Replaced a higher-intensity HIIT block partway through recovery to avoid post-exertional crashes."
  });

  await upsertPlanningPreferences(userId, {
    prioritizeRecoveryWhenSymptomsElevated: true,
    preferWorkoutTime: "morning",
    preferTaskTypeFirst: "work",
    leaveBufferAfterWork: true,
    defaultBufferMins: 30,
    avoidIntenseExerciseAfterPoorSleep: true,
    preferLighterDaysAfterHighDrainDays: true,
    notes: "Synthetic portfolio preferences - pacing is the priority while recovering from post-viral symptoms."
  });

  await ensureDefaultMorningBrief(userId);
  await seedChatHistory(userId, endDate);

  await logApiCall({
    userId,
    source: "doctor",
    label: "Pattern review",
    model: "gpt-4.1",
    inputText: "What actually seems to predict a good day for me at this point?",
    outputText: "Your best days consistently share three things: 7+ hours of sleep, no high-intensity exertion the day before, and good hydration.",
    inputTokens: 1340,
    outputTokens: 210,
    totalTokens: 1550,
    estimatedCostUsd: 0.0052,
    latencyMs: 960,
    success: true,
    metadata: { demo: true }
  });

  console.log(`Seeded ${DAY_COUNT} days of fictional portfolio data (post-viral recovery storyline) from ${startDate} through ${endDate}.`);
  console.log("Lab results and doctor visits were intentionally left empty so the upload and review flow can be tested with synthetic documents.");
}

(async () => {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (String(config?.userId || "").trim() !== DEMO_USER_ID) {
    throw new Error(`Set config.json userId to "${DEMO_USER_ID}" before running this seed.`);
  }
  await initSchema();
  if (process.argv.includes("--reset-only")) {
    await clearDemoUser(DEMO_USER_ID);
    console.log("Cleared all portfolio-demo records. Start Boris to begin onboarding.");
    return;
  }
  await seedDemoData(DEMO_USER_ID, getDemoEndDate());
})().catch((error) => {
  console.error("Demo seed failed:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
