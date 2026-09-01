const { getOpenAIClient, createTrackedResponse, setApiContext } = require("./api");
const { createEmptyDailyLog } = require("./scheduler");
const {
  APP_TIMEZONE,
  formatAppDateTimeForPrompt,
  getAppNow
} = require("./time");
const { isPlainObject, numberOrNull } = require("./utils");

const PARSER_MODEL = "gpt-4.1";

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

function createParserError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function dedupeByName(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const name = String(item?.name || "").trim();
    const key = name.toLowerCase();

    if (!name || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function formatLocalDateTimeForPrompt() {
  return formatAppDateTimeForPrompt();
}

function formatTime(hours, minutes = 0) {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function resolveTimeHint(timeHint) {
  const now = getAppNow();
  const normalized = String(timeHint || "").trim().toLowerCase();

  if (!normalized) {
    return now.time;
  }

  const agoMatch = normalized.match(/(\d+)\s*(minute|min|hour|hr)s?\s+ago/);

  if (agoMatch) {
    const amount = Number(agoMatch[1]);
    const unit = agoMatch[2];
    const offsetMinutes = /hour|hr/.test(unit) ? amount * 60 : amount;
    const currentMinutes = now.hour * 60 + now.minute;
    const adjusted = Math.max(0, currentMinutes - offsetMinutes);
    return formatTime(Math.floor(adjusted / 60), adjusted % 60);
  }

  if (/just|just now|now|right now|currently/.test(normalized)) {
    return now.time;
  }

  if (/this morning|morning|breakfast/.test(normalized)) {
    return formatTime(8, 0);
  }

  if (/lunch|midday|noon|afternoon/.test(normalized)) {
    return formatTime(12, 30);
  }

  if (/dinner|this evening|evening|tonight/.test(normalized)) {
    return formatTime(19, 0);
  }

  if (/earlier/.test(normalized)) {
    const adjusted = Math.max(0, now.hour * 60 + now.minute - 120);
    return formatTime(Math.floor(adjusted / 60), adjusted % 60);
  }

  const hhmmMatch = normalized.match(/\b(\d{1,2}):(\d{2})\b/);

  if (hhmmMatch) {
    const hours = Math.min(23, Number(hhmmMatch[1]));
    const minutes = Math.min(59, Number(hhmmMatch[2]));
    return formatTime(hours, minutes);
  }

  return now.time;
}

function getExistingNames(items) {
  return Array.isArray(items)
    ? items
        .map((entry) =>
          typeof entry === "string" ? entry : String(entry?.name || "").trim()
        )
        .filter(Boolean)
    : [];
}

async function callOpenAIJson({ systemPrompt, payload, label }) {
  const client = getOpenAIClient();

  if (!client) {
    throw createParserError(
      "OPENAI_API_KEY is not set, so Tell Boris parsing is unavailable.",
      503
    );
  }

  setApiContext("parser", "/parse");

  const { response, usage } = await createTrackedResponse({
    model: PARSER_MODEL,
    instructions: systemPrompt,
    input: JSON.stringify(payload, null, 2)
  }, {
    label
  });

  const output = response.output_text && response.output_text.trim();

  if (!output) {
    throw createParserError(`OpenAI returned an empty response while ${label}.`, 502);
  }

  try {
    return {
      data: JSON.parse(output),
      usage
    };
  } catch (_error) {
    throw createParserError(`OpenAI returned invalid JSON while ${label}.`, 502);
  }
}

function buildParseSystemPrompt(existingLog) {
  const supplements = getExistingNames(existingLog?.supplements);
  const symptoms = getExistingNames(existingLog?.symptoms);

  return [
    "You extract structured health-tracking data from a free-form user message.",
    `Current local time is ${formatLocalDateTimeForPrompt()}.`,
    "Return only valid JSON and no markdown.",
    "Return only the fields clearly mentioned in the message.",
    "Do not include null for missing fields. Omit fields that were not mentioned.",
    'If nothing health-related is detected, return exactly {"unrecognized": true, "message": "I didn\'t catch any health data in that. Can you rephrase?"}.',
    "Use this schema when needed:",
    '{',
    '  "supplements": [{ "name": "Vitamin D", "timeHint": "just now" }],',
    '  "symptoms": [{ "name": "Headache", "present": true, "timeHint": "this morning" }],',
    '  "meals": [{ "description": "oatmeal with berries", "timeHint": "breakfast" }],',
    '  "exercise": [{ "description": "30 minute walk", "type": "walk", "duration": 30, "timeHint": "just now" }],',
    '  "vitals": {',
    '    "sleep": { "hours": 7, "quality": 4 },',
    '    "energy": { "morning": 6, "evening": 8 },',
    '    "mood": 7,',
    '    "stress": 8,',
    '    "restingHR": 62,',
    '    "bloodPressure": { "systolic": 120, "diastolic": 80 }',
    "  },",
    '  "flareDay": true,',
    '  "goodDay": true,',
    '  "whatChanged": "trying a new supplement today",',
    '  "journal": "short reflection that does not fit elsewhere",',
    '  "_parsed": "brief explanation of any assumption or ambiguity"',
    "}",
    "Map mood to 1-10 where 1 is very low and 10 is excellent.",
    "Map stress to 1-10 where 1 is calm and 10 is extreme stress.",
    "Map energy to morning or evening based on explicit wording like 'this morning' or 'tonight'.",
    "If energy timing is ambiguous, infer from the current time and explain that in _parsed.",
    "Use existing names when there is a clear match.",
    `Existing supplement names: ${supplements.join(", ") || "none"}.`,
    `Existing symptom names: ${symptoms.join(", ") || "none"}.`,
    "For exercise include a short type such as walk, run, strength, yoga, cardio, cycling, stretching.",
    "For journal only capture reflective observations that do not fit the other structured fields."
  ].join(" ");
}

function buildMealMacroPrompt() {
  return [
    "You estimate nutrition macros for meal descriptions.",
    "Return only valid JSON.",
    'Use this exact shape: {"meals":[{"description":"oatmeal with berries","calories":320,"protein":10,"carbs":54,"fat":7}]}.',
    "Estimate a typical serving size.",
    "All returned macro fields must be integers."
  ].join(" ");
}

function normalizeParserOutput(output) {
  if (!isPlainObject(output)) {
    throw createParserError("OpenAI returned an invalid parser payload.", 502);
  }

  return output;
}

async function estimateMealMacros(meals) {
  if (!Array.isArray(meals) || meals.length === 0) {
    return {
      meals: [],
      _openaiUsage: []
    };
  }

  const { data: macroPayload, usage } = await callOpenAIJson({
    systemPrompt: buildMealMacroPrompt(),
    payload: {
      meals: meals.map((meal) => ({
        description: meal.description
      }))
    },
    label: "estimating meal macros"
  });

  if (!Array.isArray(macroPayload?.meals)) {
    throw createParserError("OpenAI returned invalid meal macro data.", 502);
  }

  const macroMap = new Map(
    macroPayload.meals.map((meal) => [
      String(meal.description || "").trim().toLowerCase(),
      {
        calories: Math.max(0, Math.round(numberOrNull(meal.calories) || 0)),
        protein: Math.max(0, Math.round(numberOrNull(meal.protein) || 0)),
        carbs: Math.max(0, Math.round(numberOrNull(meal.carbs) || 0)),
        fat: Math.max(0, Math.round(numberOrNull(meal.fat) || 0))
      }
    ])
  );

  return {
    meals: meals.map((meal) => ({
      ...meal,
      macros:
        macroMap.get(String(meal.description || "").trim().toLowerCase()) || {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        }
    })),
    _openaiUsage: usage ? [usage] : []
  };
}

function mergeChecklistItems(existingItems, parsedItems, type) {
  const merged = Array.isArray(existingItems)
    ? existingItems.map((item) =>
        typeof item === "string"
          ? { name: item, [type === "supplement" ? "taken" : "present"]: true, time: null }
          : { ...item }
      )
    : [];

  const keyField = type === "supplement" ? "taken" : "present";

  for (const parsedItem of parsedItems) {
    const rawName = String(parsedItem?.name || "").trim();

    if (!rawName) {
      continue;
    }

    const existing = merged.find(
      (item) => String(item?.name || "").trim().toLowerCase() === rawName.toLowerCase()
    );
    const time = resolveTimeHint(parsedItem.timeHint);
    const nextState = parsedItem[keyField] === false ? false : true;

    if (existing) {
      existing[keyField] = nextState;
      existing.time = nextState ? time : null;
      continue;
    }

    merged.push({
      name: rawName,
      [keyField]: nextState,
      time: nextState ? time : null
    });
  }

  return dedupeByName(merged);
}

function appendMeals(existingMeals, parsedMeals) {
  const meals = Array.isArray(existingMeals) ? [...existingMeals] : [];

  for (const meal of parsedMeals) {
    const description = String(meal?.description || "").trim();

    if (!description) {
      continue;
    }

    meals.push({
      description,
      time: resolveTimeHint(meal.timeHint),
      macros: {
        calories: numberOrNull(meal?.macros?.calories),
        protein: numberOrNull(meal?.macros?.protein),
        carbs: numberOrNull(meal?.macros?.carbs),
        fat: numberOrNull(meal?.macros?.fat)
      },
      source: "parse"
    });
  }

  return meals;
}

function appendExercise(existingExercise, parsedExercise) {
  const exercise = Array.isArray(existingExercise) ? [...existingExercise] : [];

  for (const item of parsedExercise) {
    const description = String(item?.description || item?.type || "").trim();

    if (!description) {
      continue;
    }

    exercise.push({
      description,
      type: String(item?.type || "").trim() || null,
      duration: numberOrNull(item?.duration),
      time: resolveTimeHint(item?.timeHint),
      feeling: null
    });
  }

  return exercise;
}

function appendText(existingText, incomingText, separator = "\n") {
  const existing = String(existingText || "").trim();
  const incoming = String(incomingText || "").trim();

  if (!incoming) {
    return existing || "";
  }

  if (!existing) {
    return incoming;
  }

  if (existing.includes(incoming)) {
    return existing;
  }

  return `${existing}${separator}${incoming}`;
}

function buildStoragePatch(parsed, existingLog) {
  const patch = {};

  if (Array.isArray(parsed.supplements) && parsed.supplements.length) {
    patch.supplements = mergeChecklistItems(
      existingLog?.supplements,
      parsed.supplements.map((item) => ({
        name: item?.name,
        taken: true,
        timeHint: item?.timeHint
      })),
      "supplement"
    );
  }

  if (Array.isArray(parsed.symptoms) && parsed.symptoms.length) {
    patch.symptoms = mergeChecklistItems(
      existingLog?.symptoms,
      parsed.symptoms.map((item) => ({
        name: item?.name,
        present: item?.present === false ? false : true,
        timeHint: item?.timeHint
      })),
      "symptom"
    );
  }

  if (Array.isArray(parsed.meals) && parsed.meals.length) {
    patch.intake = {
      ...(patch.intake || {}),
      meals: appendMeals(existingLog?.intake?.meals, parsed.meals)
    };
  }

  if (Array.isArray(parsed.exercise) && parsed.exercise.length) {
    patch.exercise = appendExercise(existingLog?.exercise, parsed.exercise);
  }

  if (isPlainObject(parsed.vitals)) {
    const vitalsPatch = {};

    if (isPlainObject(parsed.vitals.sleep)) {
      const sleepPatch = {};

      if (numberOrNull(parsed.vitals.sleep.hours) !== null) {
        sleepPatch.hours = numberOrNull(parsed.vitals.sleep.hours);
      }

      if (numberOrNull(parsed.vitals.sleep.quality) !== null) {
        sleepPatch.quality = Math.max(
          1,
          Math.min(10, Math.round(numberOrNull(parsed.vitals.sleep.quality)))
        );
      }

      if (Object.keys(sleepPatch).length) {
        vitalsPatch.sleep = sleepPatch;
      }
    }

    if (isPlainObject(parsed.vitals.energy)) {
      const energyPatch = {};

      if (numberOrNull(parsed.vitals.energy.morning) !== null) {
        energyPatch.morning = Math.max(
          1,
          Math.min(10, Math.round(numberOrNull(parsed.vitals.energy.morning)))
        );
      }

      if (numberOrNull(parsed.vitals.energy.evening) !== null) {
        energyPatch.evening = Math.max(
          1,
          Math.min(10, Math.round(numberOrNull(parsed.vitals.energy.evening)))
        );
      }

      if (Object.keys(energyPatch).length) {
        vitalsPatch.energy = energyPatch;
      }
    }

    if (numberOrNull(parsed.vitals.mood) !== null) {
      vitalsPatch.mood = Math.max(
        1,
        Math.min(10, Math.round(numberOrNull(parsed.vitals.mood)))
      );
    }

    if (numberOrNull(parsed.vitals.stress) !== null) {
      vitalsPatch.stress = Math.max(
        1,
        Math.min(10, Math.round(numberOrNull(parsed.vitals.stress)))
      );
    }

    if (numberOrNull(parsed.vitals.restingHR) !== null) {
      vitalsPatch.restingHR = Math.round(numberOrNull(parsed.vitals.restingHR));
    }

    if (isPlainObject(parsed.vitals.bloodPressure)) {
      const systolic = numberOrNull(parsed.vitals.bloodPressure.systolic);
      const diastolic = numberOrNull(parsed.vitals.bloodPressure.diastolic);

      if (systolic !== null && diastolic !== null) {
        vitalsPatch.bloodPressure = {
          systolic: Math.round(systolic),
          diastolic: Math.round(diastolic)
        };
      }
    }

    if (Object.keys(vitalsPatch).length) {
      patch.vitals = vitalsPatch;
    }
  }

  if (typeof parsed.flareDay === "boolean") {
    patch.flareDay = parsed.flareDay;
  }

  if (typeof parsed.goodDay === "boolean") {
    patch.vitals = {
      ...(patch.vitals || {}),
      goodDay: parsed.goodDay
    };
  }

  if (typeof parsed.whatChanged === "string" && parsed.whatChanged.trim()) {
    patch.whatChanged = appendText(existingLog?.whatChanged, parsed.whatChanged, "; ");
  }

  if (typeof parsed.journal === "string" && parsed.journal.trim()) {
    patch.journal = appendText(existingLog?.journal, parsed.journal, "\n");
  }

  return patch;
}

function buildLoggedSummary(parsedResponse) {
  const logged = {};

  if (Array.isArray(parsedResponse.supplements) && parsedResponse.supplements.length) {
    logged.supplements = parsedResponse.supplements.map((item) => ({
      name: String(item?.name || "").trim(),
      timeHint: item?.timeHint || null
    }));
  }

  if (Array.isArray(parsedResponse.symptoms) && parsedResponse.symptoms.length) {
    logged.symptoms = parsedResponse.symptoms.map((item) => ({
      name: String(item?.name || "").trim(),
      present: item?.present === false ? false : true,
      timeHint: item?.timeHint || null
    }));
  }

  if (Array.isArray(parsedResponse.meals) && parsedResponse.meals.length) {
    logged.meals = parsedResponse.meals.map((meal) => ({
      description: String(meal?.description || "").trim(),
      macros: meal?.macros || null,
      timeHint: meal?.timeHint || null
    }));
  }

  if (Array.isArray(parsedResponse.exercise) && parsedResponse.exercise.length) {
    logged.exercise = parsedResponse.exercise.map((item) => ({
      description: String(item?.description || item?.type || "").trim(),
      duration: numberOrNull(item?.duration),
      type: String(item?.type || "").trim() || null,
      timeHint: item?.timeHint || null
    }));
  }

  if (isPlainObject(parsedResponse.vitals)) {
    logged.vitals = parsedResponse.vitals;
  }

  if (typeof parsedResponse.flareDay === "boolean") {
    logged.flareDay = parsedResponse.flareDay;
  }

  if (typeof parsedResponse.goodDay === "boolean") {
    logged.goodDay = parsedResponse.goodDay;
  }

  if (typeof parsedResponse.whatChanged === "string" && parsedResponse.whatChanged.trim()) {
    logged.whatChanged = parsedResponse.whatChanged.trim();
  }

  if (typeof parsedResponse.journal === "string" && parsedResponse.journal.trim()) {
    logged.journal = parsedResponse.journal.trim();
  }

  return logged;
}

async function parseHealthInput(message, existingLog) {
  const normalizedMessage = String(message || "").trim();

  if (!normalizedMessage) {
    throw createParserError("The 'message' field is required.", 400);
  }

  const logContext = isPlainObject(existingLog)
    ? existingLog
    : createEmptyDailyLog(getAppNow().date);

  const {
    data: rawParsedResponse,
    usage: parseUsage
  } = await callOpenAIJson({
      systemPrompt: buildParseSystemPrompt(logContext),
      payload: {
        message: normalizedMessage,
        existingLog: logContext,
        currentLocalDateTime: formatLocalDateTimeForPrompt()
      },
      label: "parsing the Tell Boris message"
    });
  const parsedResponse = normalizeParserOutput(rawParsedResponse);
  const usageEntries = parseUsage ? [parseUsage] : [];

  if (parsedResponse.unrecognized === true) {
    return {
      unrecognized: true,
      message:
        parsedResponse.message ||
        "I didn't catch any health data in that. Can you rephrase?",
      _openaiUsage: usageEntries
    };
  }

  if (Array.isArray(parsedResponse.meals) && parsedResponse.meals.length) {
    const macroResult = await estimateMealMacros(parsedResponse.meals);
    parsedResponse.meals = macroResult.meals;
    usageEntries.push(...(macroResult._openaiUsage || []));
  }

  const patch = buildStoragePatch(parsedResponse, logContext);

  if (!Object.keys(patch).length) {
    return {
      unrecognized: true,
      message: "I didn't catch any health data in that. Can you rephrase?",
      _openaiUsage: usageEntries
    };
  }

  const result = {
    ...patch,
    _logged: buildLoggedSummary(parsedResponse),
    _openaiUsage: usageEntries
  };

  if (typeof parsedResponse._parsed === "string" && parsedResponse._parsed.trim()) {
    result._parsed = parsedResponse._parsed.trim();
  }

  console.log("[Boris Parser] Extracted", {
    message: normalizedMessage,
    parsed: result
  });

  return result;
}

module.exports = {
  mergeDeep,
  isPlainObject,
  parseHealthInput,
  estimateMealMacros
};
