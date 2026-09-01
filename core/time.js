const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";

function getFormatter(options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    ...options
  });
}

function normalizeDateInput(input = new Date()) {
  if (input instanceof Date) {
    return input;
  }

  if (typeof input === "number") {
    return new Date(input);
  }

  const normalized = String(input ?? "").trim();

  if (!normalized) {
    return new Date();
  }

  return new Date(normalized);
}

function getAppParts(input = new Date()) {
  const safeInput = normalizeDateInput(input);

  if (Number.isNaN(safeInput.getTime())) {
    throw new RangeError("Invalid time value");
  }

  const formatter = getFormatter({
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(safeInput)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function getAppNow() {
  return getAppParts(new Date());
}

function getAppDateString(input = new Date()) {
  return getAppParts(input).date;
}

function formatAppDateTimeForPrompt(input = new Date()) {
  const parts = getAppParts(input);
  return `${parts.date} ${parts.time} (${APP_TIMEZONE})`;
}

function getTimestamp() {
  return new Date().toISOString();
}

function parseDateString(dateString) {
  const match = String(dateString || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function createDateStringAnchor(dateString) {
  const parsed = parseDateString(dateString);

  if (!parsed) {
    return null;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0));
}

function addDaysToDateString(dateString, delta) {
  const anchor = createDateStringAnchor(dateString);

  if (!anchor) {
    return dateString;
  }

  anchor.setUTCDate(anchor.getUTCDate() + Number(delta || 0));
  const year = anchor.getUTCFullYear();
  const month = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const day = String(anchor.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(dateString, options = {}) {
  const anchor = createDateStringAnchor(dateString);

  if (!anchor) {
    return String(dateString || "");
  }

  return getFormatter({
    weekday: options.includeWeekday ? "long" : undefined,
    month: "long",
    day: options.includeDay === false ? undefined : "numeric",
    year: "numeric"
  }).format(anchor);
}

module.exports = {
  APP_TIMEZONE,
  addDaysToDateString,
  formatAppDateTimeForPrompt,
  formatDisplayDate,
  getAppDateString,
  getAppNow,
  getTimestamp
};
