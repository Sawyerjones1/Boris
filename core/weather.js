const { getActiveUser } = require("./db");
const { getLog, updateLog } = require("./neon");
const { getAppDateString, getTimestamp } = require("./time");
const { numberOrNull } = require("./utils");

function getTodayDateString() {
  return getAppDateString();
}

function getDateStringForWeatherTimestamp(unixSeconds) {
  return getAppDateString(new Date(Number(unixSeconds) * 1000));
}

function pickCondition(entries) {
  const counts = new Map();

  entries.forEach((entry) => {
    const description = String(entry?.weather?.[0]?.description || "").trim();

    if (!description) {
      return;
    }

    counts.set(description, (counts.get(description) || 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

async function fetchWeatherPayload(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenWeatherMap responded with ${response.status}.`);
  }

  return response.json();
}

async function fetchCurrentWeatherPayload(apiKey, lat, lon, units) {
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("units", units);
  url.searchParams.set("appid", apiKey);
  return fetchWeatherPayload(url);
}

async function fetchForecastWeatherPayload(apiKey, lat, lon, units) {
  const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("units", units);
  url.searchParams.set("appid", apiKey);
  return fetchWeatherPayload(url);
}

function buildWeatherFromForecast(payload, date) {
  const entries = Array.isArray(payload?.list) ? payload.list : [];
  const dayEntries = entries.filter((entry) => getDateStringForWeatherTimestamp(entry?.dt) === date);
  const relevantEntries = dayEntries.length ? dayEntries : entries.slice(0, 8);
  const highTemps = relevantEntries.map((entry) => numberOrNull(entry?.main?.temp_max)).filter((value) => value !== null);
  const lowTemps = relevantEntries.map((entry) => numberOrNull(entry?.main?.temp_min)).filter((value) => value !== null);
  const latestEntry = relevantEntries.at(-1) || relevantEntries[0] || {};

  return {
    condition: pickCondition(relevantEntries),
    tempHighF: highTemps.length ? Math.max(...highTemps) : numberOrNull(latestEntry?.main?.temp_max),
    tempLowF: lowTemps.length ? Math.min(...lowTemps) : numberOrNull(latestEntry?.main?.temp_min),
    humidity: numberOrNull(latestEntry?.main?.humidity),
    pressure: numberOrNull(latestEntry?.main?.pressure),
    uvIndex: null,
    pulledAt: getTimestamp()
  };
}

function mergeTodayWeather(currentPayload, forecastPayload, date) {
  const entries = Array.isArray(forecastPayload?.list) ? forecastPayload.list : [];
  const dayEntries = entries.filter((entry) => getDateStringForWeatherTimestamp(entry?.dt) === date);
  const futureHighs = dayEntries.map((entry) => numberOrNull(entry?.main?.temp_max)).filter((value) => value !== null);
  const futureLows = dayEntries.map((entry) => numberOrNull(entry?.main?.temp_min)).filter((value) => value !== null);
  const currentTemp = numberOrNull(currentPayload?.main?.temp);
  const currentHigh = numberOrNull(currentPayload?.main?.temp_max);
  const currentLow = numberOrNull(currentPayload?.main?.temp_min);
  const latestCondition = String(currentPayload?.weather?.[0]?.description || "").trim() || null;
  const candidatesHigh = [currentHigh, currentTemp, ...futureHighs].filter((value) => value !== null);
  const candidatesLow = [currentLow, currentTemp, ...futureLows].filter((value) => value !== null);

  return {
    condition: latestCondition,
    tempHighF: candidatesHigh.length ? Math.max(...candidatesHigh) : null,
    tempLowF: candidatesLow.length ? Math.min(...candidatesLow) : null,
    humidity: numberOrNull(currentPayload?.main?.humidity),
    pressure: numberOrNull(currentPayload?.main?.pressure),
    uvIndex: null,
    pulledAt: getTimestamp()
  };
}

async function fetchWeatherForDate(date, existingWeather) {
  const apiKey = String(process.env.OPENWEATHERMAP_API_KEY || "").trim();
  const lat = String(process.env.WEATHER_LAT || "").trim();
  const lon = String(process.env.WEATHER_LON || "").trim();
  const units = String(process.env.WEATHER_UNITS || "imperial").trim();

  if (!apiKey || !lat || !lon) {
    console.error("[Boris Weather] Missing OpenWeatherMap configuration.");
    return null;
  }

  const forecastPayload = await fetchForecastWeatherPayload(apiKey, lat, lon, units);

  if (date === getTodayDateString()) {
    const currentPayload = await fetchCurrentWeatherPayload(apiKey, lat, lon, units);
    return mergeTodayWeather(currentPayload, forecastPayload, date);
  }

  return buildWeatherFromForecast(forecastPayload, date);
}

async function getWeatherForDate(date) {
  try {
    const userId = await getActiveUser();
    const log = await getLog(userId, date);
    const isToday = date === getTodayDateString();

    if (
      !isToday &&
      log?.weather &&
      typeof log.weather === "object" &&
      log.weather.condition &&
      log.weather.tempHighF !== undefined &&
      log.weather.tempLowF !== undefined
    ) {
      return log.weather;
    }

    const weather = await fetchWeatherForDate(date, log?.weather);

    if (!weather) {
      return null;
    }

    await updateLog(userId, date, { weather });
    console.log("[Boris Weather] Weather cached", { userId, date, weather });
    return weather;
  } catch (error) {
    console.error("[Boris Weather] Failed to load weather", { date, error });
    return null;
  }
}

module.exports = {
  getWeatherForDate
};
