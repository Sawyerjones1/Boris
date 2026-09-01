const { getIsoWeekPeriod } = require("./scheduler");
const { addDaysToDateString } = require("./time");

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function averageEnergy(energy) {
  const values = [
    numberOrNull(energy?.morning),
    numberOrNull(energy?.evening)
  ].filter((value) => value !== null);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function getWeekPeriodForDate(date) {
  const anchor = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("Invalid date for trends week.");
  }
  const daysUntilSunday = (7 - anchor.getUTCDay()) % 7;
  return getIsoWeekPeriod(addDaysToDateString(date, daysUntilSunday));
}

function buildWeekBuckets(startDate, endDate) {
  const buckets = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const period = getWeekPeriodForDate(cursor);
    buckets.push({
      weekKey: period.weekLabel,
      weekStart: period.weekStart,
      weekEnd: period.weekEnd
    });
    cursor = addDaysToDateString(period.weekEnd, 1);
  }

  return buckets;
}

function summarizeDurations(values) {
  if (!values.length) return { avgDuration: null, medianDuration: null, count: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
  const average = ordered.reduce((sum, value) => sum + value, 0) / ordered.length;
  return {
    avgDuration: Number(average.toFixed(1)),
    medianDuration: Number(median.toFixed(1)),
    count: ordered.length
  };
}

function buildTrends(logs, options = {}) {
  const orderedLogs = (Array.isArray(logs) ? logs : [])
    .filter((log) => /^\d{4}-\d{2}-\d{2}$/.test(String(log?.date || "")))
    .sort((left, right) => left.date.localeCompare(right.date));
  const requestedStart = String(options.startDate || "").trim();
  const requestedEnd = String(options.endDate || "").trim();
  const startDate = options.allTime
    ? orderedLogs[0]?.date || requestedEnd
    : requestedStart;
  const endDate = requestedEnd;
  const rangeLogs = orderedLogs.filter((log) => log.date >= startDate && log.date <= endDate);
  const logsByDate = new Map(orderedLogs.map((log) => [log.date, log]));
  const weekBuckets = buildWeekBuckets(startDate, endDate);
  const weekMap = new Map(weekBuckets.map((week) => [week.weekKey, {
    ...week,
    flareDays: 0,
    symptoms: new Map()
  }]));
  const symptomNames = new Map();
  const symptomTotals = new Map();

  const sleep = [];
  const scores = [];
  const durationsBeforeFlare = [];
  const durationsBeforeNonFlare = [];

  for (const log of rangeLogs) {
    const vitals = log.vitals || {};
    sleep.push({
      date: log.date,
      hours: numberOrNull(vitals.sleep?.hours),
      flareDay: log.flareDay === true
    });
    scores.push({
      date: log.date,
      mood: numberOrNull(vitals.mood),
      energy: averageEnergy(vitals.energy),
      stress: numberOrNull(vitals.stress)
    });

    const previousLog = logsByDate.get(addDaysToDateString(log.date, -1));
    const previousDuration = (Array.isArray(previousLog?.exercise) ? previousLog.exercise : [])
      .reduce((sum, entry) => {
        const duration = numberOrNull(entry?.duration);
        return sum + (duration === null ? 0 : Math.max(0, duration));
      }, 0);
    if (log.flareDay === true) durationsBeforeFlare.push(previousDuration);
    else durationsBeforeNonFlare.push(previousDuration);

    const weekKey = getWeekPeriodForDate(log.date).weekLabel;
    const week = weekMap.get(weekKey);
    if (!week) continue;
    if (log.flareDay === true) week.flareDays += 1;

    const presentToday = new Set();
    for (const symptom of Array.isArray(log.symptoms) ? log.symptoms : []) {
      const name = String(symptom?.name || "").trim();
      const key = name.toLocaleLowerCase();
      if (!name || symptom?.present !== true || presentToday.has(key)) continue;
      presentToday.add(key);
      if (!symptomNames.has(key)) symptomNames.set(key, name);
      symptomTotals.set(key, (symptomTotals.get(key) || 0) + 1);
      week.symptoms.set(key, (week.symptoms.get(key) || 0) + 1);
    }
  }

  const rankedSymptoms = [...symptomTotals.entries()]
    .sort((left, right) => right[1] - left[1] || symptomNames.get(left[0]).localeCompare(symptomNames.get(right[0])));
  const topKeys = rankedSymptoms.slice(0, 5).map(([key]) => key);
  const otherKeys = rankedSymptoms.slice(5).map(([key]) => key);
  const symptomSeries = topKeys.map((key) => ({
    key,
    name: symptomNames.get(key),
    total: symptomTotals.get(key),
    values: weekBuckets.map((week) => ({
      weekKey: week.weekKey,
      count: weekMap.get(week.weekKey).symptoms.get(key) || 0
    }))
  }));

  if (otherKeys.length) {
    symptomSeries.push({
      key: "__other__",
      name: "Other",
      total: otherKeys.reduce((sum, key) => sum + symptomTotals.get(key), 0),
      values: weekBuckets.map((week) => ({
        weekKey: week.weekKey,
        count: otherKeys.reduce(
          (sum, key) => sum + (weekMap.get(week.weekKey).symptoms.get(key) || 0),
          0
        )
      }))
    });
  }

  return {
    range: {
      startDate,
      endDate,
      loggedDays: rangeLogs.length,
      allTime: options.allTime === true
    },
    sleep,
    weeklyFlare: weekBuckets.map((week) => ({
      ...week,
      count: weekMap.get(week.weekKey).flareDays
    })),
    scores,
    exertionBeforeFlare: {
      beforeFlareDays: summarizeDurations(durationsBeforeFlare),
      beforeNonFlareDays: summarizeDurations(durationsBeforeNonFlare)
    },
    symptomFrequency: {
      weeks: weekBuckets,
      series: symptomSeries
    }
  };
}

module.exports = {
  averageEnergy,
  buildTrends,
  summarizeDurations
};
