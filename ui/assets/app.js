const TOTAL_COMPLETION_FIELDS = 14
const APP_TIMEZONE = "America/New_York"
const WEATHER_REFRESH_INTERVAL_MS = 60 * 60 * 1000

const VITAL_READING_TYPES = {
  blood_pressure: {
    label: "Blood Pressure"
  },
  temperature: {
    label: "Temperature"
  },
  weight: {
    label: "Weight"
  }
}

const appState = {
  log: null,
  activeSupplements: [],
  activePrescriptions: [],
  symptomsMaster: [],
  symptomListSaveQueue: Promise.resolve(),
  saveQueue: Promise.resolve(),
  saveQueuesByDate: new Map(),
  pendingSaves: 0,
  logEditVersion: 0,
  dashboardLoadId: 0,
  dashboardLoading: false,
  activeModal: null,
  editingTime: null,
  pendingMealEstimate: null,
  dashboardDate: getTodayDateString(),
  intakeChecklistTab: "supplements",
  weatherRefreshTimer: null
}

const chatState = {
  mode: "free",
  conversation: [],
  recapState: {
    active: false,
    coveredFields: [],
    startedAt: null,
    interrupted: false,
    currentQuestion: null
  },
  pending: false,
  messageCount: 0,
  typingMessageId: null,
  sessionEndSent: false
}

const notesState = {
  activeTab: "identity",
  summaries: null,
  identityText: "",
  healthPictureText: "",
  summaryDetails: {}
}

const RECORD_TYPE_META = {
  lab_results: {
    tabLabel: "Lab Results",
    uploadTitle: "Upload Lab Results",
    uploadSubtitle: "PDFs and images are supported. Use the date the labs were collected, not the upload date. Boris reads files in memory only.",
    viewerTitle: "Lab Results Timeline"
  },
  doctor_visit: {
    tabLabel: "Doctor Visits",
    uploadTitle: "Add Doctor Visit",
    uploadSubtitle: "Upload a PDF or image, or paste visit notes. Boris creates a detailed summary for you to review before anything is saved.",
    viewerTitle: "Doctor Visits Timeline"
  },
  prescription: {
    tabLabel: "Prescriptions",
    uploadTitle: "Add Prescription",
    uploadSubtitle: "Track your current medications here. Save the medication, what it's for, and whether it's currently active.",
    viewerTitle: "Current Medications"
  },
  supplement: {
    tabLabel: "Supplements",
    uploadTitle: "Add Supplement",
    uploadSubtitle: "Track your current supplements here. Add the product details, what's in it, and whether it's currently active. You can also scan a label photo to auto-fill the form.",
    viewerTitle: "Current Supplements"
  }
}

const SCHEDULE_DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
]

const SCHEDULE_DAY_LABELS = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun"
}

const CALENDAR_COLOR_PALETTE = [
  "#5b8def",
  "#4f9c82",
  "#c9a53f",
  "#a879d8",
  "#d2765a",
  "#4c9fb3",
  "#9b8ad0",
  "#b47b62"
]

const recordsState = {
  activeType: "lab_results",
  items: [],
  expandedRecordId: null,
  openMenuRecordId: null,
  editingRecordId: null,
  editDraft: null,
  selectedFile: null,
  supplementScanFile: null,
  pendingExtraction: null,
  loading: false,
  notice: ""
}

const schedulesState = {
  activeTab: "recurring",
  googleConnected: false,
  calendarView: "week",
  recurringEditorOpen: false,
  recurring: [],
  preferences: null,
  calendarEvents: []
}

const devLogsState = {
  summary: null,
  items: [],
  selectedId: null,
  offset: 0,
  limit: 20,
  hasMore: false,
  loadingList: false,
  listRequestId: 0
}

const automationsState = {
  items: [],
  status: {
    telegramConfigured: false,
    timezone: APP_TIMEZONE
  }
}

const trendsState = {
  days: "90",
  data: null,
  symptomColors: new Map(),
  nextSymptomColor: 0
}

function getTodayDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })

  return formatter.format(new Date())
}

function shiftDateString(dateString, offsetDays) {
  const [year, month, day] = String(dateString || "").split("-").map(Number)
  const date = new Date(year || 0, (month || 1) - 1, day || 1)
  date.setDate(date.getDate() + Number(offsetDays || 0))

  const nextYear = date.getFullYear()
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0")
  const nextDay = String(date.getDate()).padStart(2, "0")
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function getDashboardDateString() {
  return appState.dashboardDate || getTodayDateString()
}

function isViewingToday() {
  return getDashboardDateString() === getTodayDateString()
}

function createDefaultLog(dateString = getTodayDateString()) {
  return {
    date: dateString,
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
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ""
}

function dedupeNames(items) {
  const seen = new Set()
  const deduped = []

  for (const item of items) {
    const name = String(item || "").trim()
    const key = name.toLowerCase()

    if (!name || seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(name)
  }

  return deduped
}

function normalizeSupplementEntry(entry) {
  if (typeof entry === "string") {
    return {
      name: entry,
      taken: true,
      time: null
    }
  }

  if (!isObject(entry)) {
    return null
  }

  return {
    name: String(entry.name || "").trim(),
    taken: Boolean(entry.taken),
    time: entry.time || null
  }
}

function normalizeSymptomEntry(entry) {
  if (typeof entry === "string") {
    return {
      name: entry,
      present: true,
      logged: true,
      time: null
    }
  }

  if (!isObject(entry)) {
    return null
  }

  return {
    name: String(entry.name || "").trim(),
    present: Boolean(entry.present),
    logged: entry.logged === undefined ? Boolean(entry.present) : Boolean(entry.logged),
    time: entry.time || null
  }
}

function normalizeMealEntry(entry) {
  if (typeof entry === "string") {
    return {
      description: entry,
      time: null,
      macros: { calories: null, protein: null, carbs: null, fat: null },
      source: "manual"
    }
  }

  if (!isObject(entry)) {
    return null
  }

  const macros = isObject(entry.macros) ? entry.macros : {}

  return {
    description: String(entry.description || "").trim(),
    time: entry.time || null,
    source: entry.source || "manual",
    macros: {
      calories: numberOrNull(macros.calories),
      protein: numberOrNull(macros.protein),
      carbs: numberOrNull(macros.carbs),
      fat: numberOrNull(macros.fat)
    }
  }
}

function normalizeExerciseEntry(entry) {
  if (typeof entry === "string") {
    return {
      description: entry,
      duration: null,
      time: null,
      feeling: null
    }
  }

  if (!isObject(entry)) {
    return null
  }

  return {
    description: String(entry.description || "").trim(),
    duration: numberOrNull(entry.duration),
    time: entry.time || null,
    feeling: numberOrNull(entry.feeling)
  }
}

function normalizeJournalEntry(entry) {
  if (!isObject(entry)) {
    return null
  }

  const note = String(entry.note || entry.text || "").trim()

  if (!note) {
    return null
  }

  return {
    id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    time: hasValue(entry.time) ? String(entry.time) : null,
    note
  }
}

function normalizeVitalReading(entry) {
  if (!isObject(entry)) {
    return null
  }

  const type = String(entry.type || "").trim()

  if (!VITAL_READING_TYPES[type]) {
    return null
  }

  return {
    id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type,
    time: hasValue(entry.time) ? String(entry.time) : null,
    values: isObject(entry.values) ? entry.values : {},
    note: hasValue(entry.note) ? String(entry.note) : ""
  }
}

function buildChecklistItems(masterList, entries, fieldName) {
  const map = new Map()

  entries.forEach((entry) => {
    if (!entry || !entry.name) {
      return
    }

    map.set(entry.name.toLowerCase(), entry)
  })

  return dedupeNames([...masterList, ...entries.map((entry) => entry.name)]).map((name) => {
    const existing = map.get(name.toLowerCase())

    if (fieldName === "present") {
      return {
        name,
        present: existing ? Boolean(existing.present) : false,
        logged: existing ? Boolean(existing.logged) || Boolean(existing.present) : false,
        time: existing ? existing.time || null : null
      }
    }

    return {
      name,
      taken: existing ? Boolean(existing.taken) : false,
      time: existing ? existing.time || null : null
    }
  })
}

function normalizeLog(rawLog) {
  const base = createDefaultLog(rawLog?.date || getTodayDateString())
  const rawVitals = isObject(rawLog?.vitals) ? rawLog.vitals : {}
  const rawSleep = isObject(rawVitals.sleep) ? rawVitals.sleep : {}
  const rawEnergy = isObject(rawVitals.energy) ? rawVitals.energy : {}
  const rawIntake = isObject(rawLog?.intake) ? rawLog.intake : {}

  base.userId = String(rawLog?.userId || "").trim() || null
  base.lastUpdated = rawLog?.lastUpdated || null
  base.vitals.sleep.hours = numberOrNull(rawSleep.hours)
  base.vitals.sleep.quality = numberOrNull(rawSleep.quality)
  base.vitals.energy.morning = numberOrNull(rawEnergy.morning)
  base.vitals.energy.evening = numberOrNull(rawEnergy.evening)
  base.vitals.mood = numberOrNull(rawVitals.mood)
  base.vitals.stress = numberOrNull(rawVitals.stress)
  base.vitals.goodDay = rawVitals.goodDay === null || rawVitals.goodDay === undefined
    ? false
    : Boolean(rawVitals.goodDay)
  base.vitals.hrv = numberOrNull(rawVitals.hrv)
  base.vitals.restingHR = numberOrNull(rawVitals.restingHR)
  base.supplements = Array.isArray(rawLog?.supplements)
    ? rawLog.supplements.map(normalizeSupplementEntry).filter(Boolean)
    : []
  base.intake.meals = Array.isArray(rawIntake.meals)
    ? rawIntake.meals.map(normalizeMealEntry).filter(Boolean)
    : []
  base.intake.caffeine = hasValue(rawIntake.caffeine) ? String(rawIntake.caffeine) : ""
  base.intake.alcohol = hasValue(rawIntake.alcohol) ? String(rawIntake.alcohol) : ""
  base.intake.water = hasValue(rawIntake.water) ? String(rawIntake.water) : ""
  base.exercise = Array.isArray(rawLog?.exercise)
    ? rawLog.exercise.map(normalizeExerciseEntry).filter(Boolean)
    : []
  base.symptoms = Array.isArray(rawLog?.symptoms)
    ? rawLog.symptoms.map(normalizeSymptomEntry).filter(Boolean)
    : []
  base.flareDay = Boolean(rawLog?.flareDay)
  base.whatChanged = hasValue(rawLog?.whatChanged) ? String(rawLog.whatChanged) : ""
  base.journal = hasValue(rawLog?.journal) ? String(rawLog.journal) : ""
  base.journalEntries = Array.isArray(rawLog?.journalEntries)
    ? rawLog.journalEntries.map(normalizeJournalEntry).filter(Boolean)
    : (base.journal
        ? [{
            id: "legacy-journal-entry",
            time: null,
            note: base.journal
          }]
        : [])
  base.vitalsReadings = Array.isArray(rawLog?.vitalsReadings)
    ? rawLog.vitalsReadings.map(normalizeVitalReading).filter(Boolean)
    : []

  return base
}

function getCurrentTimeStamp() {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })

  return formatter.format(new Date())
}

function formatTimeLabel(value) {
  if (!hasValue(value)) {
    return "No time"
  }

  const [hours, minutes] = String(value).split(":")
  const date = new Date()
  date.setHours(Number(hours) || 0, Number(minutes) || 0, 0, 0)

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })
}

function getVitalReadingValueLabel(entry) {
  const values = isObject(entry?.values) ? entry.values : {}

  if (entry?.type === "blood_pressure") {
    const systolic = hasValue(values.systolic) ? values.systolic : "--"
    const diastolic = hasValue(values.diastolic) ? values.diastolic : "--"
    return `${systolic}/${diastolic}`
  }

  if (entry?.type === "temperature") {
    const temperature = hasValue(values.temperature) ? values.temperature : "--"
    const unit = hasValue(values.unit) ? values.unit : "F"
    return `${temperature} ${unit}`
  }

  if (entry?.type === "weight") {
    const weight = hasValue(values.weight) ? values.weight : "--"
    const unit = hasValue(values.unit) ? values.unit : "lb"
    return `${weight} ${unit}`
  }

  return "--"
}

function sortEntriesByTimeDescending(items) {
  return [...items].sort((left, right) => {
    const leftTime = String(left?.time || "")
    const rightTime = String(right?.time || "")
    return rightTime.localeCompare(leftTime)
  })
}

function formatDateLabel(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number)
  const date = new Date(year || 0, (month || 1) - 1, day || 1)

  return date.toLocaleDateString([], {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric"
  })
}

function getWeatherIcon(condition) {
  const text = String(condition || "").toLowerCase()

  if (text.includes("thunderstorm")) {
    return "⛈️"
  }

  if (text.includes("snow")) {
    return "❄️"
  }

  if (text.includes("rain") || text.includes("drizzle")) {
    return "🌧️"
  }

  if (text.includes("mist") || text.includes("fog") || text.includes("haze") || text.includes("smoke")) {
    return "🌫️"
  }

  if (text.includes("cloud")) {
    return "⛅"
  }

  if (text.includes("clear")) {
    return "☀️"
  }

  return "•"
}

function renderWeatherWidget(weather) {
  const widget = document.getElementById("weather-widget")

  if (!widget) {
    return
  }

  if (!weather || !weather.condition) {
    widget.className = "weather-widget weather-widget-loading"
    widget.innerHTML = `
      <span class="weather-icon">--</span>
      <span class="weather-condition">Weather pending</span>
      <span class="weather-stat">H:--° L:--°</span>
      <span class="weather-stat">--%</span>
      <span class="weather-stat">---- hPa</span>
    `
    return
  }

  const pressureClass = Number(weather.pressure) < 1005
    ? "weather-stat weather-stat-pressure is-low"
    : "weather-stat weather-stat-pressure"

  widget.className = "weather-widget"
  widget.innerHTML = `
    <span class="weather-icon">${getWeatherIcon(weather.condition)}</span>
    <span class="weather-condition">${escapeHtml(weather.condition)}</span>
    <span class="weather-stat">H:${hasValue(weather.tempHighF) ? Math.round(Number(weather.tempHighF)) : "--"}° L:${hasValue(weather.tempLowF) ? Math.round(Number(weather.tempLowF)) : "--"}°</span>
    <span class="weather-stat">${hasValue(weather.humidity) ? Number(weather.humidity) : "--"}%</span>
    <span class="${pressureClass}">${hasValue(weather.pressure) ? Number(weather.pressure) : "----"} hPa</span>
  `
}

async function loadWeatherData() {
  if (!isViewingToday()) {
    renderWeatherWidget(appState.log?.weather || null)
    return
  }

  renderWeatherWidget(null)
  const selectedDate = getDashboardDateString()
  const loadId = appState.dashboardLoadId
  const isCurrent = () => loadId === appState.dashboardLoadId
    && selectedDate === getDashboardDateString() && appState.log?.date === selectedDate

  try {
    const weather = await fetchJson("/weather/today", {
      cache: "no-store"
    })
    if (!isCurrent()) return
    appState.log.weather = weather
    renderWeatherWidget(weather)
  } catch (_error) {
    if (!isCurrent()) return
    renderWeatherWidget(appState.log?.weather || null)
  }
}

function stopWeatherRefreshLoop() {
  if (appState.weatherRefreshTimer) {
    window.clearInterval(appState.weatherRefreshTimer)
    appState.weatherRefreshTimer = null
  }
}

function ensureWeatherRefreshLoop() {
  stopWeatherRefreshLoop()

  if (!isViewingToday()) {
    return
  }

  appState.weatherRefreshTimer = window.setInterval(() => {
    if (document.hidden || !isViewingToday()) {
      return
    }

    loadWeatherData().catch(() => {})
  }, WEATHER_REFRESH_INTERVAL_MS)
}

function getRecordTypeMeta(type) {
  return RECORD_TYPE_META[type] || RECORD_TYPE_META.lab_results
}

function getRecordTypeLabel(type) {
  return getRecordTypeMeta(type).tabLabel
}

function isMedicationRecordType(type) {
  return ["prescription", "supplement"].includes(String(type || "").trim().toLowerCase())
}

function isSupplementRecordType(type) {
  return String(type || "").trim().toLowerCase() === "supplement"
}

function isPrescriptionRecordType(type) {
  return String(type || "").trim().toLowerCase() === "prescription"
}

function isDoctorVisitRecordType(type) {
  return String(type || "").trim().toLowerCase() === "doctor_visit"
}

function getMedicationTerm(type) {
  return isSupplementRecordType(type)
    ? "Supplement"
    : "Prescription"
}

function createEmptySupplementIngredient() {
  return {
    name: "",
    amount: "",
    unit: "",
    dailyValuePercent: ""
  }
}

function cloneRecordForEdit(record) {
  return JSON.parse(JSON.stringify({
    recordId: record.recordId,
    type: record.type,
    date: record.date,
    source: record.source || "",
    notes: record.notes || "",
    extractedData: record.extractedData || { values: [] },
    rawText: record.rawText || null
  }))
}

function getFlagBadge(flag) {
  const normalized = String(flag || "normal").toLowerCase()

  if (normalized === "borderline") {
    return { icon: "◐", label: "Borderline", className: "is-borderline" }
  }

  if (normalized === "high" || normalized === "low" || normalized === "critical") {
    return { icon: "⚠", label: normalized === "critical" ? "Critical" : normalized[0].toUpperCase() + normalized.slice(1), className: "is-flagged" }
  }

  return { icon: "✓", label: "Normal", className: "is-normal" }
}

async function loadActiveSupplements() {
  try {
    const supplements = await fetchJson("/supplements/active")
    appState.activeSupplements = Array.isArray(supplements) ? supplements : []
  } catch (_error) {
    appState.activeSupplements = []
  }

  return appState.activeSupplements
}

async function loadActivePrescriptions() {
  try {
    const prescriptions = await fetchJson("/prescriptions/active")
    appState.activePrescriptions = Array.isArray(prescriptions) ? prescriptions : []
  } catch (_error) {
    appState.activePrescriptions = []
  }

  return appState.activePrescriptions
}

async function loadSymptomTrackingList() {
  const response = await fetchJson("/tracking/symptoms")
  return Array.isArray(response?.items) ? dedupeNames(response.items) : []
}

function saveSymptomTrackingList() {
  const items = [...appState.symptomsMaster]
  const save = appState.symptomListSaveQueue.then(() => fetchJson("/tracking/symptoms", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items })
  }))

  appState.symptomListSaveQueue = save.catch(() => {})
  return save
}

function syncDashboardTrackingLists() {
  const symptomNamesFromLog = appState.log.symptoms.map((item) => item.name)
  const activeIntakeNames = dedupeNames([
    ...appState.activeSupplements.map((item) => item.name),
    ...appState.activePrescriptions.map((item) => item.name)
  ])

  appState.symptomsMaster = dedupeNames([
    ...appState.symptomsMaster,
    ...symptomNamesFromLog
  ])

  appState.log.supplements = buildChecklistItems(activeIntakeNames, appState.log.supplements, "taken")
  appState.log.symptoms = buildChecklistItems(appState.symptomsMaster, appState.log.symptoms, "present")
}

function getCompletionCount() {
  const log = appState.log
  const completedFields = [
    hasValue(log.vitals.sleep.hours) || hasValue(log.vitals.sleep.quality),
    hasValue(log.vitals.energy.morning) || hasValue(log.vitals.energy.evening),
    hasValue(log.vitals.mood),
    hasValue(log.vitals.stress),
    Array.isArray(log.vitalsReadings) && log.vitalsReadings.length > 0,
    Array.isArray(log.supplements) && log.supplements.length > 0,
    Array.isArray(log.symptoms) && log.symptoms.length > 0,
    Array.isArray(log.intake.meals) && log.intake.meals.length > 0,
    Array.isArray(log.exercise) && log.exercise.length > 0,
    hasValue(log.intake.caffeine) || hasValue(log.intake.alcohol) || hasValue(log.intake.water),
    hasValue(log.whatChanged),
    Array.isArray(log.journalEntries) && log.journalEntries.length > 0
  ]

  return completedFields.filter(Boolean).length
}

function setStatus(message, variant = "") {
  const status = document.getElementById("save-status")

  if (!status) {
    return
  }

  status.textContent = message
  status.classList.remove("is-loading", "is-error", "is-success")

  if (variant) {
    status.classList.add(variant)
  }
}

function showToast(message, variant = "info") {
  const region = document.getElementById("toast-region")

  if (!region) {
    return
  }

  const toast = document.createElement("div")
  toast.className = `toast is-${variant}`
  toast.textContent = message
  region.appendChild(toast)

  window.setTimeout(() => {
    toast.remove()
  }, 3800)
}

function setCardLoading(cardKey, isLoading) {
  const card = document.querySelector(`[data-card="${cardKey}"]`)
  card?.classList.toggle("is-loading", isLoading)
}

function updateRangePresentation(input, display, value, isEmpty) {
  const numericValue = Number(value)
  const min = Number(input.min || 1)
  const max = Number(input.max || 10)
  const percent = ((numericValue - min) / (max - min)) * 100

  input.style.setProperty("--range-progress", `${percent}%`)
  input.dataset.empty = isEmpty ? "true" : "false"
  display.textContent = isEmpty ? "--" : numericValue
}

function setRangeControl(id, value) {
  const input = document.getElementById(id)
  const display = document.getElementById(`${id}-value`)

  if (!input || !display) {
    return
  }

  const empty = !hasValue(value)
  const fallback = 5
  input.value = empty ? String(fallback) : String(value)
  updateRangePresentation(input, display, empty ? fallback : value, empty)
}

function setInputValue(id, value) {
  const input = document.getElementById(id)

  if (input) {
    input.value = hasValue(value) ? value : ""
  }
}

function getEditKey(type, name) {
  return `${type}:${String(name).toLowerCase()}`
}

function formatMacro(label, value) {
  return `${label} ${hasValue(value) ? value : "--"}`
}

function getMealMacroTotals() {
  return appState.log.intake.meals.reduce((totals, meal) => {
    const calories = numberOrNull(meal?.macros?.calories)
    const protein = numberOrNull(meal?.macros?.protein)
    const carbs = numberOrNull(meal?.macros?.carbs)
    const fat = numberOrNull(meal?.macros?.fat)

    if (calories !== null) {
      totals.calories += calories
    }

    if (protein !== null) {
      totals.protein += protein
    }

    if (carbs !== null) {
      totals.carbs += carbs
    }

    if (fat !== null) {
      totals.fat += fat
    }

    return totals
  }, {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
}

function renderMealsSummary() {
  const summary = document.getElementById("meals-summary")

  if (!summary) {
    return
  }

  const totals = getMealMacroTotals()

  summary.textContent = `Today: ${totals.calories ? `${Math.round(totals.calories).toLocaleString()} cal` : "-- cal"} | ${totals.protein ? `${Math.round(totals.protein)}g protein` : "--g protein"} | ${totals.carbs ? `${Math.round(totals.carbs)}g carbs` : "--g carbs"} | ${totals.fat ? `${Math.round(totals.fat)}g fat` : "--g fat"}`
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;")
}

function getChecklistSubset(entries, names) {
  const allowedNames = new Set(dedupeNames(names).map((name) => name.toLowerCase()))

  return Array.isArray(entries)
    ? entries.filter((entry) => allowedNames.has(String(entry?.name || "").toLowerCase()))
    : []
}

function renderIntakeChecklistTabs() {
  const activeTab = appState.intakeChecklistTab || "supplements"
  const supplementsList = document.getElementById("supplements-list")
  const medicationsList = document.getElementById("medications-list")

  document.querySelectorAll("[data-checklist-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.checklistTab === activeTab)
  })

  if (supplementsList) {
    supplementsList.hidden = activeTab !== "supplements"
  }

  if (medicationsList) {
    medicationsList.hidden = activeTab !== "medications"
  }
}

function setIntakeChecklistTab(tab) {
  const normalizedTab = tab === "medications" ? "medications" : "supplements"
  appState.intakeChecklistTab = normalizedTab
  renderIntakeChecklistTabs()
}

function renderChecklist(containerId, items, type, options = {}) {
  const container = document.getElementById(containerId)
  const emptyMessage = String(options.emptyMessage || "Nothing added yet.")
  const allowRemove = options.allowRemove === true

  if (!container) {
    return
  }

  if (!items.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`
    return
  }

  container.innerHTML = items.map((item) => {
    const checked = type === "symptom" ? item.present : item.taken
    const statusLabel = checked
      ? "Logged for today"
      : type === "symptom"
        ? (item.logged ? "Marked not present" : "Not logged today")
        : "Not taken yet"
    const timeLabel = checked && item.time ? `Logged ${formatTimeLabel(item.time)}` : "No time logged"
    const editKey = getEditKey(type, item.name)
    const isEditing = appState.editingTime === editKey

    return `
      <div class="checklist-item">
        <label class="checklist-main">
          <input
            type="checkbox"
            data-${type}-toggle="${escapeAttribute(item.name)}"
            ${checked ? "checked" : ""}
          />
          <div class="checklist-copy">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${statusLabel}</small>
          </div>
        </label>
        <div class="checklist-meta">
          ${isEditing ? `
            <div class="time-editor">
              <input
                class="time-editor-input"
                type="time"
                value="${escapeAttribute(item.time || getCurrentTimeStamp())}"
                data-${type}-time-input="${escapeAttribute(item.name)}"
              />
              <button class="mini-button" type="button" data-${type}-time-save="${escapeAttribute(item.name)}">Save</button>
              <button class="mini-button" type="button" data-${type}-time-cancel="${escapeAttribute(item.name)}">Cancel</button>
            </div>
          ` : `
            <span class="meta-time">${timeLabel}</span>
            <div class="checklist-actions">
              <button
                class="mini-button"
                type="button"
                data-${type}-edit="${escapeAttribute(item.name)}"
              >
                Time
              </button>
              ${allowRemove ? `
                <button
                  class="icon-button icon-button-danger"
                  type="button"
                  data-${type}-remove="${escapeAttribute(item.name)}"
                  aria-label="Remove ${escapeAttribute(item.name)}"
                  title="Remove"
                >
                  X
                </button>
              ` : ""}
            </div>
          `}
        </div>
      </div>
    `
  }).join("")
}

function renderMeals() {
  const mealsList = document.getElementById("meals-list")

  renderMealsSummary()

  if (!mealsList) {
    return
  }

  if (!appState.log.intake.meals.length) {
    mealsList.innerHTML = '<div class="empty-state">No meals logged yet.</div>'
    return
  }

  mealsList.innerHTML = appState.log.intake.meals.map((meal, index) => {
    const editKey = `meal:${index}`
    const isEditing = appState.editingTime === editKey

    return `
    <article class="entry-card">
      <div class="entry-meta">
        <strong>${escapeHtml(meal.description || "Meal")}</strong>
        ${isEditing ? `
          <div class="time-editor">
            <input
              class="time-editor-input"
              type="time"
              value="${escapeAttribute(meal.time || getCurrentTimeStamp())}"
              data-meal-time-input="${index}"
            />
            <button class="mini-button" type="button" data-meal-time-save="${index}">Save</button>
            <button class="mini-button" type="button" data-meal-time-cancel="${index}">Cancel</button>
          </div>
        ` : `
          <small>${meal.time ? `Logged at ${formatTimeLabel(meal.time)}` : "Logged today"}</small>
        `}
      </div>
      <div class="entry-stats">
        <span class="stat-chip">${formatMacro("Cal", meal.macros.calories)}</span>
        <span class="stat-chip">${formatMacro("P", meal.macros.protein)}g</span>
        <span class="stat-chip">${formatMacro("C", meal.macros.carbs)}g</span>
        <span class="stat-chip">${formatMacro("F", meal.macros.fat)}g</span>
        <div class="entry-actions">
          <button class="mini-button" type="button" data-meal-edit="${index}">Edit time</button>
          <button
            class="icon-button icon-button-danger"
            type="button"
            data-meal-delete="${index}"
            aria-label="Delete meal"
            title="Delete"
          >
            X
          </button>
        </div>
      </div>
    </article>
  `
  }).join("")
}

function renderExercise() {
  const exerciseList = document.getElementById("exercise-list")

  if (!exerciseList) {
    return
  }

  if (!appState.log.exercise.length) {
    exerciseList.innerHTML = '<div class="empty-state">No exercise logged yet.</div>'
    return
  }

  exerciseList.innerHTML = appState.log.exercise.map((entry) => `
    <article class="entry-card">
      <div class="entry-meta">
        <strong>${escapeHtml(entry.description || "Exercise")}</strong>
        <small>
          ${entry.time ? `Logged at ${formatTimeLabel(entry.time)}` : "Logged today"}${entry.duration ? ` · ${entry.duration} min` : ""}
        </small>
      </div>
      <div class="entry-stats">
        <span class="stat-chip">Feeling ${hasValue(entry.feeling) ? entry.feeling : "--"}/10</span>
      </div>
    </article>
  `).join("")
}

function renderWaterButtons() {
  document.querySelectorAll("[data-water]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.water === appState.log.intake.water)
  })
}

function renderHero() {
  const hero = document.getElementById("hero-panel")
  const flareButton = document.getElementById("flare-toggle")
  const goodButton = document.getElementById("good-day-toggle")
  const flareIndicator = document.getElementById("flare-indicator")
  const completion = document.getElementById("completion-text")
  const dateNode = document.getElementById("today-date")
  const dateInput = document.getElementById("dashboard-date-input")
  const dateNote = document.getElementById("dashboard-date-note")
  const nextButton = document.getElementById("dashboard-next-date")
  const flareActive = Boolean(appState.log.flareDay)
  const goodActive = Boolean(appState.log.vitals.goodDay)
  const viewingToday = isViewingToday()

  if (dateNode) {
    dateNode.textContent = formatDateLabel(appState.log.date)
  }

  if (dateInput) {
    dateInput.value = appState.log.date
    dateInput.max = getTodayDateString()
  }

  if (dateNote) {
    dateNote.textContent = viewingToday
      ? "Viewing today."
      : `Viewing saved log for ${formatDateLabel(appState.log.date)}.`
  }

  if (nextButton) {
    nextButton.disabled = viewingToday
  }

  if (completion) {
    completion.textContent = `${getCompletionCount()} of ${TOTAL_COMPLETION_FIELDS} logged`
  }

  hero?.classList.toggle("hero-flare", flareActive)
  hero?.classList.toggle("hero-good", goodActive)
  flareButton?.classList.toggle("is-active", flareActive)
  flareButton?.setAttribute("aria-pressed", String(flareActive))
  goodButton?.classList.toggle("is-active", goodActive)
  goodButton?.setAttribute("aria-pressed", String(goodActive))

  const flareState = flareButton?.querySelector(".state-toggle-state")
  const goodState = goodButton?.querySelector(".state-toggle-state")

  if (flareState) {
    flareState.textContent = flareActive ? "Active" : "Off"
  }

  if (goodState) {
    goodState.textContent = goodActive ? "Active" : "Off"
  }

  if (flareIndicator) {
    flareIndicator.textContent = flareActive ? "FLARE DAY" : "Calm"
    flareIndicator.classList.toggle("is-flare", flareActive)
  }
}

function updateJournalCount() {
  const journalCount = document.getElementById("journal-count")

  if (!journalCount) {
    return
  }

  journalCount.textContent = `${appState.log.journalEntries.length} entr${appState.log.journalEntries.length === 1 ? "y" : "ies"}`
}

function renderVitalsReadingInputs() {
  const type = document.getElementById("vitals-reading-type")?.value || "blood_pressure"
  const container = document.getElementById("vitals-reading-dynamic-fields")

  if (!container) {
    return
  }

  if (type === "blood_pressure") {
    container.innerHTML = `
      <label class="field">
        <span>Systolic</span>
        <input id="vitals-reading-systolic" type="number" min="0" placeholder="118" />
      </label>
      <label class="field">
        <span>Diastolic</span>
        <input id="vitals-reading-diastolic" type="number" min="0" placeholder="76" />
      </label>
    `
    return
  }

  if (type === "temperature") {
    container.innerHTML = `
      <label class="field">
        <span>Temperature</span>
        <input id="vitals-reading-temperature" type="number" step="0.1" placeholder="98.4" />
      </label>
      <label class="field">
        <span>Unit</span>
        <select id="vitals-reading-temperature-unit">
          <option value="F">F</option>
          <option value="C">C</option>
        </select>
      </label>
    `
    return
  }

  container.innerHTML = `
    <label class="field">
      <span>Weight</span>
      <input id="vitals-reading-weight" type="number" step="0.1" placeholder="166.2" />
    </label>
    <label class="field">
      <span>Unit</span>
      <select id="vitals-reading-weight-unit">
        <option value="lb">lb</option>
        <option value="kg">kg</option>
      </select>
    </label>
  `
}

function renderVitalsReadings() {
  const list = document.getElementById("vitals-readings-list")

  if (!list) {
    return
  }

  const readings = sortEntriesByTimeDescending(appState.log.vitalsReadings)

  if (!readings.length) {
    list.innerHTML = `<p class="empty-note">No vitals logged yet today.</p>`
    return
  }

  list.innerHTML = readings.map((entry) => `
    <article class="dashboard-entry-card">
      <div class="dashboard-entry-copy">
        <div class="dashboard-entry-topline">
          <strong>${escapeHtml(VITAL_READING_TYPES[entry.type]?.label || "Vital")}</strong>
          <span class="dashboard-entry-time">${escapeHtml(formatTimeLabel(entry.time))}</span>
        </div>
        <p class="dashboard-entry-value">${escapeHtml(getVitalReadingValueLabel(entry))}</p>
        ${entry.note ? `<p class="dashboard-entry-note">${escapeHtml(entry.note)}</p>` : ""}
      </div>
      <button class="entry-delete-button" type="button" data-vitals-delete="${escapeAttribute(entry.id)}">Delete</button>
    </article>
  `).join("")
}

function renderJournalEntries() {
  const list = document.getElementById("journal-entries-list")

  if (!list) {
    return
  }

  const entries = sortEntriesByTimeDescending(appState.log.journalEntries)

  if (!entries.length) {
    list.innerHTML = `<p class="empty-note">No journal entries yet today.</p>`
    return
  }

  list.innerHTML = entries.map((entry) => `
    <article class="dashboard-entry-card">
      <div class="dashboard-entry-copy">
        <div class="dashboard-entry-topline">
          <strong>Journal entry</strong>
          <span class="dashboard-entry-time">${escapeHtml(formatTimeLabel(entry.time))}</span>
        </div>
        <p class="dashboard-entry-note">${escapeHtml(entry.note)}</p>
      </div>
      <button class="entry-delete-button" type="button" data-journal-delete="${escapeAttribute(entry.id)}">Delete</button>
    </article>
  `).join("")
}

function renderDashboard() {
  if (!appState.log) {
    return
  }

  const supplementNames = appState.activeSupplements.map((item) => item.name)
  const medicationNames = appState.activePrescriptions.map((item) => item.name)

  renderHero()
  setInputValue("sleep-hours", appState.log.vitals.sleep.hours)
  setRangeControl("sleep-quality", appState.log.vitals.sleep.quality)
  setRangeControl("energy-morning", appState.log.vitals.energy.morning)
  setRangeControl("energy-evening", appState.log.vitals.energy.evening)
  setRangeControl("mood", appState.log.vitals.mood)
  setRangeControl("stress", appState.log.vitals.stress)
  renderChecklist(
    "supplements-list",
    getChecklistSubset(appState.log.supplements, supplementNames),
    "supplement",
    { emptyMessage: "Add supplements in Records to see them here." }
  )
  renderChecklist(
    "medications-list",
    getChecklistSubset(appState.log.supplements, medicationNames),
    "medication",
    { emptyMessage: "Add medications in Records to see them here." }
  )
  renderChecklist("symptoms-list", appState.log.symptoms, "symptom", {
    allowRemove: true
  })
  renderIntakeChecklistTabs()
  renderMeals()
  renderPendingMealEstimate()
  renderExercise()
  setRangeControl("exercise-feeling", 5)
  setInputValue("stimulant", appState.log.intake.caffeine)
  setInputValue("alcohol", appState.log.intake.alcohol)
  renderWaterButtons()
  setInputValue("what-changed", appState.log.whatChanged)
  setInputValue("vitals-reading-time", getCurrentTimeStamp())
  setInputValue("journal-entry-time", getCurrentTimeStamp())
  renderVitalsReadingInputs()
  renderVitalsReadings()
  renderJournalEntries()
  updateJournalCount()
}

async function fetchJson(url, options) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }

  return payload
}

async function fetchText(url, options) {
  const response = await fetch(url, options)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(text || "Request failed")
  }

  return {
    text,
    lastUpdated: response.headers.get("X-Last-Updated") || null
  }
}

function mergeLogPatch(target, patch) {
  if (!isObject(target) || !isObject(patch)) {
    return patch
  }

  const merged = { ...target }

  Object.entries(patch).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      merged[key] = value
      return
    }

    if (isObject(value) && isObject(target[key])) {
      merged[key] = mergeLogPatch(target[key], value)
      return
    }

    merged[key] = value
  })

  return merged
}

function setDashboardLoading(loading) {
  appState.dashboardLoading = loading
  // Date navigation stays available, but old-day fields must not be edited
  // while a new day is loading.
  document.querySelectorAll("[data-card], #flare-toggle, #good-day-toggle").forEach((node) => {
    node.inert = loading
    node.setAttribute("aria-busy", String(loading))
    node.classList.toggle("is-loading", loading)
  })
}

async function loadDashboardData(selectedDate = getDashboardDateString()) {
  const loadId = ++appState.dashboardLoadId
  const isCurrent = () => loadId === appState.dashboardLoadId && selectedDate === getDashboardDateString()
  appState.dashboardDate = selectedDate
  setDashboardLoading(true)
  const viewingToday = isViewingToday()
  ensureWeatherRefreshLoop()
  setStatus(viewingToday ? "Loading today's log..." : "Loading selected log...", "is-loading")
  // On returning to a day, fetch its state after outstanding saves for that day
  // finish. Saves for other dates do not delay navigation.
  await appState.saveQueuesByDate.get(selectedDate)
  if (!isCurrent()) return
  const logPromise = viewingToday
    ? fetchJson("/log/today")
    : fetchJson(`/log/${encodeURIComponent(selectedDate)}`)
  const activeSupplementsPromise = loadActiveSupplements()
  const activePrescriptionsPromise = loadActivePrescriptions()
  const symptomsPromise = loadSymptomTrackingList()

  try {
    const [log, , , symptoms] = await Promise.all([
      logPromise,
      activeSupplementsPromise,
      activePrescriptionsPromise,
      symptomsPromise
    ])
    if (!isCurrent()) return
    if (log.date !== selectedDate) throw new Error("The server returned a log for a different date. Reload this day.")
    appState.log = normalizeLog(log)
    appState.symptomsMaster = symptoms
    appState.pendingMealEstimate = null
    syncDashboardTrackingLists()
    renderDashboard()
    setDashboardLoading(false)
    loadWeatherData().catch(() => {})
    setStatus("Ready", "is-success")
  } catch (error) {
    const settled = await Promise.allSettled([
      activeSupplementsPromise,
      activePrescriptionsPromise,
      symptomsPromise
    ])
    if (!isCurrent()) return
    if (!String(error.message || "").includes("No log found")) {
      setStatus(error.message, "is-error")
      showToast(error.message, "error")
      return
    }
    appState.log = createDefaultLog(selectedDate)
    appState.symptomsMaster = settled[2].status === "fulfilled" ? settled[2].value : []
    appState.pendingMealEstimate = null
    syncDashboardTrackingLists()
    renderDashboard()
    setDashboardLoading(false)
    loadWeatherData().catch(() => {})
    setStatus("No log for this date yet", "is-success")
  }
}

function queueSave(patch, options = {}) {
  const { card = "", message = "Saved" } = options
  const targetDate = getDashboardDateString()
  if (appState.dashboardLoading || appState.log?.date !== targetDate) {
    showToast("Wait for this day's log to load before editing.", "error")
    return Promise.resolve()
  }
  const loadId = appState.dashboardLoadId
  const editVersion = ++appState.logEditVersion
  const isCurrent = () => loadId === appState.dashboardLoadId && !appState.dashboardLoading
    && targetDate === getDashboardDateString() && appState.log?.date === targetDate
  // Event handlers may mutate their arrays again before this queued request runs.
  const savedPatch = JSON.parse(JSON.stringify(patch))
  appState.log = normalizeLog(mergeLogPatch(appState.log, savedPatch))
  renderDashboard()
  appState.pendingSaves += 1
  setStatus("Saving...", "is-loading")

  if (card) {
    setCardLoading(card, true)
  }

  const save = appState.saveQueue
    .then(async () => {
      const updatedLog = await fetchJson("/log/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          date: targetDate,
          patch: savedPatch
        })
      })

      if (updatedLog.date !== targetDate) throw new Error("The save response belongs to a different date. Reload this day.")
      if (!isCurrent()) return
      // A newer queued save or input event owns the displayed draft now.
      if (editVersion === appState.logEditVersion) {
        appState.log = normalizeLog(updatedLog)
        syncDashboardTrackingLists()
        renderDashboard()
        setStatus(message, "is-success")
      } else {
        setStatus(appState.pendingSaves > 1 ? "Saving..." : "Unsaved changes", "is-loading")
      }
    })
    .catch((error) => {
      if (isCurrent()) setStatus(error.message, "is-error")
      showToast(`Could not save ${targetDate}: ${error.message}`, "error")
    })
    .finally(() => {
      appState.pendingSaves = Math.max(0, appState.pendingSaves - 1)
      if (appState.saveQueuesByDate.get(targetDate) === save) appState.saveQueuesByDate.delete(targetDate)

      if (card && isCurrent()) {
        setCardLoading(card, false)
      }

      if (isCurrent() && editVersion === appState.logEditVersion && appState.pendingSaves === 0
          && !document.getElementById("save-status")?.classList.contains("is-error")) {
        window.setTimeout(() => {
          if (isCurrent() && editVersion === appState.logEditVersion && appState.pendingSaves === 0
              && !document.getElementById("save-status")?.classList.contains("is-error")) {
            setStatus("All changes saved", "is-success")
          }
        }, 240)
      }
    })

  appState.saveQueue = save
  appState.saveQueuesByDate.set(targetDate, save)
  return save
}

function findItemByName(items, name) {
  return items.find((item) => item.name.toLowerCase() === name.toLowerCase())
}

function updateIntakeItem(name, checked) {
  const item = findItemByName(appState.log.supplements, name)

  if (!item) {
    return
  }

  item.taken = checked
  item.time = checked ? item.time || getCurrentTimeStamp() : null
  queueSave({ supplements: appState.log.supplements }, { card: "supplements", message: "Intake checklist saved" })
}

function startEditingTime(type, name) {
  appState.editingTime = type === "meal" ? `meal:${name}` : getEditKey(type, name)
  renderDashboard()
}

function stopEditingTime() {
  appState.editingTime = null
  renderDashboard()
}

function saveIntakeTime(name, value) {
  const item = findItemByName(appState.log.supplements, name)

  if (!item) {
    return
  }

  item.taken = true
  item.time = value.trim() || getCurrentTimeStamp()
  appState.editingTime = null
  queueSave({ supplements: appState.log.supplements }, { card: "supplements", message: "Intake time updated" })
}

function updateSymptom(name, checked) {
  const item = findItemByName(appState.log.symptoms, name)

  if (!item) {
    return
  }

  item.present = checked
  item.logged = true
  item.time = checked ? item.time || getCurrentTimeStamp() : null
  queueSave({ symptoms: appState.log.symptoms }, { card: "symptoms", message: "Symptoms updated" })
}

function saveSymptomTime(name, value) {
  const item = findItemByName(appState.log.symptoms, name)

  if (!item) {
    return
  }

  item.present = true
  item.logged = true
  item.time = value.trim() || getCurrentTimeStamp()
  appState.editingTime = null
  queueSave({ symptoms: appState.log.symptoms }, { card: "symptoms", message: "Symptom time updated" })
}

async function removeChecklistItem(type, name) {
  const currentItem = findItemByName(appState.log.symptoms, name)
  const hadLoggedEntry = Boolean(currentItem?.logged)
  appState.symptomsMaster = appState.symptomsMaster.filter((item) => item.toLowerCase() !== name.toLowerCase())
  appState.log.symptoms = appState.log.symptoms.filter((item) => item.name.toLowerCase() !== name.toLowerCase())
  appState.editingTime = null
  renderDashboard()

  try {
    await saveSymptomTrackingList()
    if (hadLoggedEntry) {
      queueSave({ symptoms: appState.log.symptoms }, { card: "symptoms", message: "Symptom removed" })
    }
  } catch (error) {
    showToast(error.message || "Could not update the symptom tracker.", "error")
  }
}

async function addToMasterList(type, name) {
  const trimmed = String(name || "").trim()

  if (!trimmed) {
    return false
  }

  appState.symptomsMaster = dedupeNames([...appState.symptomsMaster, trimmed])
  appState.log.symptoms = buildChecklistItems(appState.symptomsMaster, appState.log.symptoms, "present")
  renderDashboard()

  try {
    await saveSymptomTrackingList()
    return true
  } catch (error) {
    showToast(error.message || "Could not update the symptom tracker.", "error")
    return false
  }
}

function saveMealTime(index, value) {
  const meal = appState.log.intake.meals[index]

  if (!meal) {
    return
  }

  meal.time = value.trim() || getCurrentTimeStamp()
  appState.editingTime = null
  queueSave({ intake: { meals: appState.log.intake.meals } }, { card: "meals", message: "Meal time updated" })
}

function deleteMeal(index) {
  appState.log.intake.meals = appState.log.intake.meals.filter((_, mealIndex) => mealIndex !== index)
  appState.editingTime = null
  queueSave({ intake: { meals: appState.log.intake.meals } }, { card: "meals", message: "Meal deleted" })
}

async function getMealEstimate(description) {
  const response = await fetchJson("/estimate/macros", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      description
    })
  })

  return {
    macros: {
      calories: numberOrNull(response.calories),
      protein: numberOrNull(response.protein),
      carbs: numberOrNull(response.carbs),
      fat: numberOrNull(response.fat)
    },
    confidence: response.confidence || "medium",
    source: "estimate"
  }
}

function renderPendingMealEstimate() {
  const preview = document.getElementById("meal-estimate-preview")
  const estimate = appState.pendingMealEstimate

  if (!preview) {
    return
  }

  if (!estimate) {
    preview.innerHTML = ""
    return
  }

  preview.innerHTML = `
    <section class="meal-preview-card">
      <div class="meal-preview-header">
        <strong>${escapeHtml(estimate.description)}</strong>
      </div>
      <div class="meal-preview-macros">
        <span>~${hasValue(estimate.macros.calories) ? estimate.macros.calories : "--"} cal</span>
        <span>${hasValue(estimate.macros.protein) ? estimate.macros.protein : "--"}g protein</span>
        <span>${hasValue(estimate.macros.carbs) ? estimate.macros.carbs : "--"}g carbs</span>
        <span>${hasValue(estimate.macros.fat) ? estimate.macros.fat : "--"}g fat</span>
      </div>
      <p class="meal-preview-confidence">Confidence: ${escapeHtml(estimate.confidence || "medium")}</p>
      ${estimate.editing ? `
        <div class="meal-preview-edit-grid">
          <label class="field">
            <span>Calories</span>
            <input type="number" min="0" data-meal-macro="calories" value="${escapeAttribute(estimate.macros.calories ?? "")}" />
          </label>
          <label class="field">
            <span>Protein</span>
            <input type="number" min="0" data-meal-macro="protein" value="${escapeAttribute(estimate.macros.protein ?? "")}" />
          </label>
          <label class="field">
            <span>Carbs</span>
            <input type="number" min="0" data-meal-macro="carbs" value="${escapeAttribute(estimate.macros.carbs ?? "")}" />
          </label>
          <label class="field">
            <span>Fat</span>
            <input type="number" min="0" data-meal-macro="fat" value="${escapeAttribute(estimate.macros.fat ?? "")}" />
          </label>
        </div>
      ` : ""}
      <div class="meal-preview-actions">
        <button class="button-primary" type="button" data-meal-preview-action="save">Save</button>
        <button class="button-secondary" type="button" data-meal-preview-action="edit">${estimate.editing ? "Done editing" : "Edit"}</button>
        <button class="button-secondary" type="button" data-meal-preview-action="skip">Skip macros</button>
      </div>
    </section>
  `
}

async function savePendingMealEstimate(skipMacros = false) {
  const estimate = appState.pendingMealEstimate

  if (!estimate) {
    return
  }

  const meal = {
    description: estimate.description,
    time: getCurrentTimeStamp(),
    macros: skipMacros
      ? {
          calories: null,
          protein: null,
          carbs: null,
          fat: null
        }
      : estimate.macros,
    source: skipMacros ? "manual" : estimate.source || "estimate"
  }

  appState.log.intake.meals = [
    ...appState.log.intake.meals,
    meal
  ]
  appState.pendingMealEstimate = null
  renderDashboard()
  await queueSave(
    {
      intake: {
        meals: appState.log.intake.meals
      }
    },
    { card: "meals", message: "Meal logged" }
  )
}

async function handleMealSubmit(event) {
  event.preventDefault()
  const descriptionInput = document.getElementById("meal-description")
  const submitButton = document.getElementById("meal-submit")
  const description = descriptionInput?.value.trim()

  if (!description) {
    showToast("Enter a meal description first.", "error")
    return
  }

  setCardLoading("meals", true)
  setStatus("Estimating macros...", "is-loading")
  submitButton.disabled = true
  submitButton.textContent = "Estimating..."

  try {
    const estimate = await getMealEstimate(description)
    appState.pendingMealEstimate = {
      description,
      macros: estimate.macros,
      confidence: estimate.confidence,
      source: estimate.source,
      editing: false
    }
    descriptionInput.value = ""
    renderDashboard()
    setStatus("Review the estimate before saving.", "is-success")
  } catch (error) {
    setStatus(error.message || "Could not estimate macros", "is-error")
    showToast(error.message || "Could not estimate macros", "error")
  } finally {
    setCardLoading("meals", false)
    submitButton.disabled = false
    submitButton.textContent = "Estimate and add"
  }
}

function handleExerciseSubmit(event) {
  event.preventDefault()
  const descriptionInput = document.getElementById("exercise-description")
  const durationInput = document.getElementById("exercise-duration")
  const feelingInput = document.getElementById("exercise-feeling")
  const description = descriptionInput?.value.trim()

  if (!description) {
    showToast("Enter an exercise description first.", "error")
    return
  }

  appState.log.exercise = [
    ...appState.log.exercise,
    {
      description,
      duration: numberOrNull(durationInput?.value),
      time: getCurrentTimeStamp(),
      feeling: numberOrNull(feelingInput?.value)
    }
  ]

  descriptionInput.value = ""
  durationInput.value = ""
  feelingInput.value = "5"
  renderDashboard()
  queueSave({ exercise: appState.log.exercise }, { card: "exercise", message: "Exercise logged" })
}

function openModal(id) {
  const overlay = document.getElementById("modal-overlay")
  const modal = document.getElementById(id)

  if (!overlay || !modal) {
    return
  }

  appState.activeModal = id
  overlay.hidden = false
  document.querySelectorAll(".modal-card").forEach((node) => {
    node.hidden = node.id !== id
  })
  document.body.classList.add("modal-open")
}

function closeModal() {
  const overlay = document.getElementById("modal-overlay")

  if (!overlay) {
    return
  }

  overlay.hidden = true
  document.querySelectorAll(".modal-card").forEach((node) => {
    node.hidden = true
  })
  document.body.classList.remove("modal-open")
  appState.activeModal = null
}

async function submitTellBoris(event) {
  event.preventDefault()
  const input = document.getElementById("tell-boris-input")
  const responseNode = document.getElementById("tell-boris-response")
  const submitButton = event.currentTarget?.querySelector('button[type="submit"]')
  const message = input?.value.trim()

  if (!message) {
    responseNode.textContent = "Enter a message first."
    return
  }

  responseNode.textContent = "Boris is parsing that..."

  if (submitButton) {
    submitButton.disabled = true
    submitButton.textContent = "Sending..."
  }

  function summarizeParsedResult(parsed) {
    const logged = parsed._logged || parsed
    const lines = []

    if (Array.isArray(logged.supplements) && logged.supplements.length) {
      lines.push(logged.supplements.map((item) => `${item.name} ✓`).join(", "))
    }

    if (Array.isArray(logged.meals) && logged.meals.length) {
      lines.push(logged.meals.slice(-3).map((meal) => {
        const calories = meal?.macros?.calories
        return calories ? `${meal.description} (${calories} cal) ✓` : `${meal.description} ✓`
      }).join(", "))
    }

    if (logged.vitals?.energy?.morning !== undefined) {
      lines.push(`Energy morning: ${logged.vitals.energy.morning} ✓`)
    }

    if (logged.vitals?.energy?.evening !== undefined) {
      lines.push(`Energy evening: ${logged.vitals.energy.evening} ✓`)
    }

    if (logged.vitals?.sleep?.hours !== undefined) {
      const quality = logged.vitals?.sleep?.quality
      lines.push(
        quality !== undefined
          ? `Sleep: ${logged.vitals.sleep.hours} hours, quality ${quality} ✓`
          : `Sleep: ${logged.vitals.sleep.hours} hours ✓`
      )
    }

    if (logged.vitals?.mood !== undefined) {
      lines.push(`Mood: ${logged.vitals.mood} ✓`)
    }

    if (logged.vitals?.stress !== undefined) {
      lines.push(`Stress: ${logged.vitals.stress} ✓`)
    }

    if (logged.vitals?.restingHR !== undefined) {
      lines.push(`Resting HR: ${logged.vitals.restingHR} ✓`)
    }

    if (logged.vitals?.bloodPressure) {
      lines.push(
        `Blood pressure: ${logged.vitals.bloodPressure.systolic}/${logged.vitals.bloodPressure.diastolic} ✓`
      )
    }

    if (Array.isArray(logged.symptoms) && logged.symptoms.length) {
      lines.push(logged.symptoms.map((item) => `${item.name} ✓`).join(", "))
    }

    if (Array.isArray(logged.exercise) && logged.exercise.length) {
      lines.push(logged.exercise.map((item) => {
        const duration = item.duration ? ` (${item.duration} min)` : ""
        return `${item.description}${duration} ✓`
      }).join(", "))
    }

    if (logged.flareDay === true) {
      lines.push("Flare day ✓")
    }

    if (logged.goodDay === true || logged.vitals?.goodDay === true) {
      lines.push("Good day ✓")
    }

    if (logged.whatChanged) {
      lines.push("What changed updated ✓")
    }

    if (logged.journal) {
      lines.push("Journal updated ✓")
    }

    if (parsed._parsed) {
      lines.push(`Note: ${parsed._parsed}`)
    }

    return lines.length ? `Logged: ${lines.join(", ")}` : "Boris logged that update."
  }

  try {
    const response = await fetchJson("/parse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message
      })
    })

    if (response?.unrecognized) {
      responseNode.textContent =
        response.message || "I didn't catch any health data in that. Can you rephrase?"
      return
    }

    responseNode.textContent = summarizeParsedResult(response)
    showToast("Boris logged that update.", "success")
    input.value = ""

    window.setTimeout(() => {
      loadDashboardData().catch((error) => {
        console.error("[Boris UI] Failed to refresh after Tell Boris parse", error)
      })
    }, 3000)
  } catch (error) {
    responseNode.textContent =
      error.message || "Boris hit a problem parsing that. Try rephrasing it."
    showToast("Tell Boris could not parse that update.", "error")
  } finally {
    if (submitButton) {
      submitButton.disabled = false
      submitButton.textContent = "Send"
    }
  }
}

function toggleSidebar(forceOpen) {
  const nextState = typeof forceOpen === "boolean"
    ? forceOpen
    : !document.body.classList.contains("sidebar-open")
  const toggle = document.getElementById("sidebar-toggle")

  document.body.classList.toggle("sidebar-open", nextState)
  toggle?.setAttribute("aria-expanded", String(nextState))
}

function setupDashboardEvents() {
  document.addEventListener("input", (event) => {
    if (event.target?.closest("[data-card]")) appState.logEditVersion += 1
  })
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => toggleSidebar())
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => toggleSidebar(false))
  document.getElementById("dashboard-prev-date")?.addEventListener("click", async () => {
    await loadDashboardData(shiftDateString(getDashboardDateString(), -1))
  })
  document.getElementById("dashboard-next-date")?.addEventListener("click", async () => {
    const nextDate = shiftDateString(getDashboardDateString(), 1)

    if (nextDate > getTodayDateString()) {
      return
    }

    await loadDashboardData(nextDate)
  })
  document.getElementById("dashboard-jump-today")?.addEventListener("click", async () => {
    await loadDashboardData(getTodayDateString())
  })
  document.getElementById("dashboard-date-input")?.addEventListener("change", async (event) => {
    const nextDate = String(event.target.value || "").trim()

    if (!nextDate) {
      event.target.value = getDashboardDateString()
      return
    }

    if (nextDate > getTodayDateString()) {
      event.target.value = getTodayDateString()
      await loadDashboardData(getTodayDateString())
      return
    }

    await loadDashboardData(nextDate)
  })
  document.getElementById("flare-toggle")?.addEventListener("click", () => {
    appState.log.flareDay = !appState.log.flareDay
    queueSave({ flareDay: appState.log.flareDay }, { message: "Flare day updated" })
  })
  document.getElementById("good-day-toggle")?.addEventListener("click", () => {
    appState.log.vitals.goodDay = !appState.log.vitals.goodDay
    queueSave({ vitals: { goodDay: appState.log.vitals.goodDay } }, { message: "Good day updated" })
  })

  document.getElementById("sleep-hours")?.addEventListener("change", (event) => {
    queueSave(
      { vitals: { sleep: { hours: numberOrNull(event.target.value) } } },
      { card: "sleep", message: "Sleep saved" }
    )
  })

  ;[
    ["sleep-quality", "sleep", "Sleep saved"],
    ["energy-morning", "energy", "Energy saved"],
    ["energy-evening", "energy", "Energy saved"],
    ["mood", "mood", "Mood saved"],
    ["stress", "mood", "Stress saved"],
    ["exercise-feeling", "", ""]
  ].forEach(([id, card, message]) => {
    const input = document.getElementById(id)
    const display = document.getElementById(`${id}-value`)

    if (!input || !display) {
      return
    }

    input.addEventListener("input", () => {
      updateRangePresentation(input, display, input.value, false)
    })

    if (id === "exercise-feeling") {
      return
    }

    input.addEventListener("change", () => {
      if (id === "sleep-quality") {
        queueSave({ vitals: { sleep: { quality: Number(input.value) } } }, { card, message })
      }

      if (id === "energy-morning") {
        queueSave({ vitals: { energy: { morning: Number(input.value) } } }, { card, message })
      }

      if (id === "energy-evening") {
        queueSave({ vitals: { energy: { evening: Number(input.value) } } }, { card, message })
      }

      if (id === "mood") {
        queueSave({ vitals: { mood: Number(input.value) } }, { card, message })
      }

      if (id === "stress") {
        queueSave({ vitals: { stress: Number(input.value) } }, { card, message })
      }
    })
  })

  document.getElementById("vitals-reading-type")?.addEventListener("change", () => {
    renderVitalsReadingInputs()
  })

  document.getElementById("supplements-list")?.addEventListener("change", (event) => {
    const name = event.target?.dataset?.supplementToggle

    if (name) {
      updateIntakeItem(name, event.target.checked)
    }
  })

  document.getElementById("supplements-list")?.addEventListener("click", (event) => {
    const name = event.target?.dataset?.supplementEdit
    const saveName = event.target?.dataset?.supplementTimeSave
    const cancelName = event.target?.dataset?.supplementTimeCancel

    if (name) {
      startEditingTime("supplement", name)
    }

    if (saveName) {
      const input = document.querySelector(`[data-supplement-time-input="${CSS.escape(saveName)}"]`)
      saveIntakeTime(saveName, input?.value || "")
    }

    if (cancelName) {
      stopEditingTime()
    }
  })

  document.getElementById("medications-list")?.addEventListener("change", (event) => {
    const name = event.target?.dataset?.medicationToggle

    if (name) {
      updateIntakeItem(name, event.target.checked)
    }
  })

  document.getElementById("medications-list")?.addEventListener("click", (event) => {
    const name = event.target?.dataset?.medicationEdit
    const saveName = event.target?.dataset?.medicationTimeSave
    const cancelName = event.target?.dataset?.medicationTimeCancel

    if (name) {
      startEditingTime("medication", name)
    }

    if (saveName) {
      const input = document.querySelector(`[data-medication-time-input="${CSS.escape(saveName)}"]`)
      saveIntakeTime(saveName, input?.value || "")
    }

    if (cancelName) {
      stopEditingTime()
    }
  })

  document.getElementById("symptoms-list")?.addEventListener("change", (event) => {
    const name = event.target?.dataset?.symptomToggle

    if (name) {
      updateSymptom(name, event.target.checked)
    }
  })

  document.getElementById("symptoms-list")?.addEventListener("click", async (event) => {
    const name = event.target?.dataset?.symptomEdit
    const removeName = event.target?.dataset?.symptomRemove
    const saveName = event.target?.dataset?.symptomTimeSave
    const cancelName = event.target?.dataset?.symptomTimeCancel

    if (name) {
      startEditingTime("symptom", name)
    }

    if (removeName) {
      await removeChecklistItem("symptom", removeName)
    }

    if (saveName) {
      const input = document.querySelector(`[data-symptom-time-input="${CSS.escape(saveName)}"]`)
      saveSymptomTime(saveName, input?.value || "")
    }

    if (cancelName) {
      stopEditingTime()
    }
  })

  document.getElementById("meals-list")?.addEventListener("click", (event) => {
    const editIndex = event.target?.dataset?.mealEdit
    const deleteIndex = event.target?.dataset?.mealDelete
    const saveIndex = event.target?.dataset?.mealTimeSave
    const cancelIndex = event.target?.dataset?.mealTimeCancel

    if (editIndex !== undefined) {
      startEditingTime("meal", Number(editIndex))
    }

    if (deleteIndex !== undefined) {
      deleteMeal(Number(deleteIndex))
    }

    if (saveIndex !== undefined) {
      const input = document.querySelector(`[data-meal-time-input="${saveIndex}"]`)
      saveMealTime(Number(saveIndex), input?.value || "")
    }

    if (cancelIndex !== undefined) {
      stopEditingTime()
    }
  })

  document.getElementById("add-symptom-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    const input = document.getElementById("add-symptom-input")

    if (await addToMasterList("symptoms", input?.value)) {
      input.value = ""
      showToast("Symptom added to today's checklist.", "success")
    }
  })

  document.querySelectorAll("[data-checklist-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setIntakeChecklistTab(button.dataset.checklistTab)
    })
  })

  document.getElementById("meal-form")?.addEventListener("submit", handleMealSubmit)
  document.getElementById("meal-estimate-preview")?.addEventListener("click", async (event) => {
    const action = event.target?.dataset?.mealPreviewAction

    if (!action || !appState.pendingMealEstimate) {
      return
    }

    if (action === "edit") {
      appState.pendingMealEstimate.editing = !appState.pendingMealEstimate.editing
      renderPendingMealEstimate()
      return
    }

    if (action === "skip") {
      await savePendingMealEstimate(true)
      return
    }

    if (action === "save") {
      await savePendingMealEstimate(false)
    }
  })
  document.getElementById("meal-estimate-preview")?.addEventListener("input", (event) => {
    const macroField = event.target?.dataset?.mealMacro

    if (!macroField || !appState.pendingMealEstimate) {
      return
    }

    appState.pendingMealEstimate.macros[macroField] = numberOrNull(event.target.value)
  })
  document.getElementById("exercise-form")?.addEventListener("submit", handleExerciseSubmit)

  document.getElementById("stimulant")?.addEventListener("change", (event) => {
    queueSave({ intake: { caffeine: event.target.value.trim() } }, { card: "intake", message: "Intake saved" })
  })
  document.getElementById("alcohol")?.addEventListener("change", (event) => {
    queueSave({ intake: { alcohol: event.target.value.trim() } }, { card: "intake", message: "Intake saved" })
  })

  document.querySelectorAll("[data-water]").forEach((button) => {
    button.addEventListener("click", () => {
      appState.log.intake.water = button.dataset.water
      renderWaterButtons()
      queueSave({ intake: { water: button.dataset.water } }, { card: "intake", message: "Water saved" })
    })
  })

  document.getElementById("what-changed")?.addEventListener("input", (event) => {
    appState.log.whatChanged = event.target.value
  })
  document.getElementById("what-changed")?.addEventListener("change", (event) => {
    queueSave({ whatChanged: event.target.value.trim() }, { card: "changes", message: "Change note saved" })
  })

  document.getElementById("vitals-reading-form")?.addEventListener("submit", (event) => {
    event.preventDefault()
    const type = document.getElementById("vitals-reading-type")?.value || "blood_pressure"
    const time = String(document.getElementById("vitals-reading-time")?.value || "").trim() || getCurrentTimeStamp()
    const note = String(document.getElementById("vitals-reading-note")?.value || "").trim()
    let values = null

    if (type === "blood_pressure") {
      const systolic = numberOrNull(document.getElementById("vitals-reading-systolic")?.value)
      const diastolic = numberOrNull(document.getElementById("vitals-reading-diastolic")?.value)

      if (systolic === null || diastolic === null) {
        showToast("Enter both systolic and diastolic values.", "error")
        return
      }

      values = { systolic, diastolic }
    } else if (type === "temperature") {
      const temperature = numberOrNull(document.getElementById("vitals-reading-temperature")?.value)

      if (temperature === null) {
        showToast("Enter a temperature value.", "error")
        return
      }

      values = {
        temperature,
        unit: String(document.getElementById("vitals-reading-temperature-unit")?.value || "F")
      }
    } else {
      const weight = numberOrNull(document.getElementById("vitals-reading-weight")?.value)

      if (weight === null) {
        showToast("Enter a weight value.", "error")
        return
      }

      values = {
        weight,
        unit: String(document.getElementById("vitals-reading-weight-unit")?.value || "lb")
      }
    }

    appState.log.vitalsReadings = [
      ...appState.log.vitalsReadings,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        time,
        values,
        note
      }
    ]

    event.currentTarget.reset()
    setInputValue("vitals-reading-time", getCurrentTimeStamp())
    renderVitalsReadingInputs()
    renderDashboard()
    queueSave({ vitalsReadings: appState.log.vitalsReadings }, { card: "vitals-readings", message: "Vital saved" })
  })

  document.getElementById("vitals-readings-list")?.addEventListener("click", (event) => {
    const id = event.target?.dataset?.vitalsDelete

    if (!id) {
      return
    }

    appState.log.vitalsReadings = appState.log.vitalsReadings.filter((entry) => entry.id !== id)
    renderDashboard()
    queueSave({ vitalsReadings: appState.log.vitalsReadings }, { card: "vitals-readings", message: "Vital deleted" })
  })

  document.getElementById("journal-entry-form")?.addEventListener("submit", (event) => {
    event.preventDefault()
    const time = String(document.getElementById("journal-entry-time")?.value || "").trim() || getCurrentTimeStamp()
    const note = String(document.getElementById("journal-entry-input")?.value || "").trim()

    if (!note) {
      showToast("Enter a journal note first.", "error")
      return
    }

    appState.log.journalEntries = [
      ...appState.log.journalEntries,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        time,
        note
      }
    ]
    appState.log.journal = ""

    event.currentTarget.reset()
    setInputValue("journal-entry-time", getCurrentTimeStamp())
    renderDashboard()
    queueSave(
      {
        journal: null,
        journalEntries: appState.log.journalEntries
      },
      { card: "journal", message: "Journal entry saved" }
    )
  })

  document.getElementById("journal-entries-list")?.addEventListener("click", (event) => {
    const id = event.target?.dataset?.journalDelete

    if (!id) {
      return
    }

    appState.log.journalEntries = appState.log.journalEntries.filter((entry) => entry.id !== id)
    renderDashboard()
    queueSave(
      {
        journal: null,
        journalEntries: appState.log.journalEntries
      },
      { card: "journal", message: "Journal entry deleted" }
    )
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleSidebar(false)
      closeSummaryModal()
    }
  })

  setupSummaryButton()
}

function setupSummaryButton() {
  const btn = document.getElementById("generate-summary-btn")
  const backdrop = document.getElementById("summary-modal-backdrop")
  const closeBtn = document.getElementById("summary-modal-close")
  const body = document.getElementById("summary-modal-body")

  if (!btn) return

  let pendingOverwrite = false

  btn.addEventListener("click", async () => {
    btn.disabled = true
    btn.textContent = "Generating..."

    try {
      const payload = pendingOverwrite
        ? { date: getDashboardDateString(), overwrite: true }
        : { date: getDashboardDateString() }
      const result = await fetchJson("/cron/rundaily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })

      pendingOverwrite = false
      const daily = result.results?.daily

      if (daily?.skipped && daily.reason === "exists") {
        btn.textContent = "Regenerate?"
        btn.disabled = false
        pendingOverwrite = true
        showToast("Summary already exists for this date. Click again to regenerate.", "info")
        return
      }

      if (daily?.skipped && daily.reason === "no_data") {
        btn.textContent = "Generate Summary"
        btn.disabled = false
        showToast("No data logged for this date yet.", "info")
        return
      }

      if (daily?.success && daily.summary) {
        showSummaryModal(daily.summary)
      } else {
        showToast("Summary generated.", "success")
      }

      btn.textContent = "Generate Summary"
      btn.disabled = false
    } catch (error) {
      btn.textContent = "Generate Summary"
      btn.disabled = false
      pendingOverwrite = false
      showToast(error.message || "Failed to generate summary.", "error")
    }
  })

  closeBtn?.addEventListener("click", closeSummaryModal)
  backdrop?.addEventListener("click", (event) => {
    if (event.target === backdrop) closeSummaryModal()
  })
}

function showSummaryModal(markdownText) {
  const backdrop = document.getElementById("summary-modal-backdrop")
  const body = document.getElementById("summary-modal-body")
  if (!backdrop || !body) return

  body.innerHTML = renderRichMarkdown(markdownText)

  backdrop.hidden = false
}

function closeSummaryModal() {
  const backdrop = document.getElementById("summary-modal-backdrop")
  if (backdrop) backdrop.hidden = true
}

function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries())
}

function addOnboardingCareRow(type) {
  const normalizedType = type === "medications" ? "medications" : "supplements"
  const container = document.getElementById(`onboarding-${normalizedType}`)

  if (!container) {
    return
  }

  const label = normalizedType === "medications" ? "medication" : "supplement"
  const row = document.createElement("div")
  row.className = "onboarding-care-row"
  row.innerHTML = `
    <div class="onboarding-care-fields">
      <label class="field"><span>Name</span><input data-onboarding-care="name" type="text" placeholder="${label === "medication" ? "Medication name" : "Supplement name"}" /></label>
      <label class="field"><span>Dose <em>Optional</em></span><input data-onboarding-care="dose" type="text" placeholder="10 mg" /></label>
      <label class="field"><span>Frequency <em>Optional</em></span><input data-onboarding-care="frequency" type="text" placeholder="Daily" /></label>
      <label class="field"><span>Timing <em>Optional</em></span><input data-onboarding-care="timeOfDay" type="text" placeholder="Morning" /></label>
      <label class="field onboarding-care-purpose"><span>Purpose <em>Optional</em></span><input data-onboarding-care="purpose" type="text" placeholder="What is it for?" /></label>
    </div>
    <button class="icon-button icon-button-danger" type="button" data-onboarding-remove aria-label="Remove ${label}" title="Remove ${label}">×</button>
  `
  container.appendChild(row)
  row.querySelector("input")?.focus()
}

function collectOnboardingCareItems(type) {
  return [...document.querySelectorAll(`#onboarding-${type} .onboarding-care-row`)]
    .map((row) => Object.fromEntries(
      [...row.querySelectorAll("[data-onboarding-care]")].map((input) => [input.dataset.onboardingCare, input.value.trim()])
    ))
    .filter((item) => item.name)
}

async function setupOnboarding() {
  const form = document.getElementById("onboarding-form")
  const status = document.getElementById("form-status")
  const submitButton = form?.querySelector('button[type="submit"]')

  if (!form || !status) {
    return
  }

  document.querySelectorAll("[data-onboarding-add]").forEach((button) => {
    button.addEventListener("click", () => addOnboardingCareRow(button.dataset.onboardingAdd))
  })

  document.querySelectorAll(".onboarding-care-list").forEach((container) => {
    container.addEventListener("click", (event) => {
      event.target.closest("[data-onboarding-remove]")?.closest(".onboarding-care-row")?.remove()
    })
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()

    if (form.dataset.submitting === "true") {
      return
    }

    form.dataset.submitting = "true"
    if (submitButton) {
      submitButton.disabled = true
    }
    status.textContent = "Creating your profile and health picture..."

    try {
      await fetchJson("/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...serializeForm(form),
          medications: collectOnboardingCareItems("medications"),
          supplements: collectOnboardingCareItems("supplements")
        })
      })

      status.textContent = "Profile and health picture created. Redirecting..."
      window.location.assign("/")
    } catch (error) {
      status.textContent = error.message
      form.dataset.submitting = "false"
      if (submitButton) {
        submitButton.disabled = false
      }
    }
  })
}

async function setupDashboard() {
  appState.log = createDefaultLog()
  renderDashboard()
  renderWeatherWidget(null)
  setupDashboardEvents()
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isViewingToday()) {
      loadWeatherData().catch(() => {})
    }
  })
  await loadDashboardData()
}

async function setupShellPage() {
  document.getElementById("sidebar-toggle")?.addEventListener("click", () => toggleSidebar())
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => toggleSidebar(false))
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleSidebar(false)
    }
  })
}

const TOUR_PAGE_HREFS = {
  dashboard: "/",
  chat: "/chat",
  records: "/records",
  schedules: "/schedules",
  automations: "/automations",
  trends: "/trends",
  notes: "/notes"
}

const tourState = {
  visited: new Set(),
  loadPromise: null,
  page: null,
  steps: [],
  index: 0,
  active: false,
  marking: false,
  openedCleanupSelector: null,
  sidebarOpened: false,
  repositionFrame: null
}

function getPageTourSteps() {
  const source = document.getElementById("boris-page-tour")
  if (!source) return []

  try {
    const steps = JSON.parse(source.textContent || "[]")
    return Array.isArray(steps) ? steps : []
  } catch (error) {
    console.error("[Boris Tour] Invalid page tour configuration", error)
    return []
  }
}

async function loadTourVisitedPages() {
  if (!tourState.loadPromise) {
    tourState.loadPromise = fetchJson("/api/tour/visited")
      .then((payload) => {
        tourState.visited = new Set(Array.isArray(payload.visited) ? payload.visited : [])
        return tourState.visited
      })
      .catch((error) => {
        tourState.loadPromise = null
        throw error
      })
  }
  return tourState.loadPromise
}

function renderTourNavDots() {
  Object.entries(TOUR_PAGE_HREFS).forEach(([pageKey, href]) => {
    document.querySelectorAll(`.sidebar-nav .nav-link[href="${href}"]`).forEach((link) => {
      let dot = link.querySelector(".tour-unread-dot")
      const unread = !tourState.visited.has(pageKey)

      if (unread && !dot) {
        dot = document.createElement("span")
        dot.className = "tour-unread-dot"
        dot.setAttribute("aria-hidden", "true")
        link.appendChild(dot)
      } else if (!unread && dot) {
        dot.remove()
      }
    })
  })
}

function getTourElements(step) {
  const selectors = Array.isArray(step?.selectors)
    ? step.selectors
    : [step?.selector]
  return selectors
    .map((selector) => String(selector || "").trim())
    .filter(Boolean)
    .map((selector) => document.querySelector(selector))
    .filter(Boolean)
}

function ensureTourUi() {
  let root = document.getElementById("boris-tour")
  if (root) return root

  root = document.createElement("div")
  root.id = "boris-tour"
  root.className = "tour-layer"
  root.hidden = true
  root.innerHTML = `
    <button class="tour-backdrop" type="button" aria-label="Skip tutorial"></button>
    <div class="tour-spotlight" aria-hidden="true"></div>
    <section class="tour-callout" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <button class="tour-skip" type="button">Skip</button>
      <p id="tour-counter" class="tour-counter"></p>
      <h3 id="tour-title"></h3>
      <p id="tour-body" class="tour-body"></p>
      <div class="tour-actions">
        <button id="tour-back" class="button-secondary" type="button">Back</button>
        <button id="tour-next" class="button-primary" type="button">Next</button>
      </div>
    </section>`
  document.body.appendChild(root)
  root.querySelector(".tour-backdrop")?.addEventListener("click", () => finishPageTour())
  root.querySelector(".tour-skip")?.addEventListener("click", () => finishPageTour())
  root.querySelector("#tour-back")?.addEventListener("click", () => showTourStep(tourState.index - 1))
  root.querySelector("#tour-next")?.addEventListener("click", () => {
    if (tourState.index >= tourState.steps.length - 1) {
      finishPageTour()
    } else {
      showTourStep(tourState.index + 1)
    }
  })
  return root
}

function getTourTargetRect(elements) {
  const rects = elements
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)

  if (!rects.length) return null
  const padding = 8
  return {
    top: Math.max(8, Math.min(...rects.map((rect) => rect.top)) - padding),
    left: Math.max(8, Math.min(...rects.map((rect) => rect.left)) - padding),
    right: Math.min(window.innerWidth - 8, Math.max(...rects.map((rect) => rect.right)) + padding),
    bottom: Math.min(window.innerHeight - 8, Math.max(...rects.map((rect) => rect.bottom)) + padding)
  }
}

function positionTourUi() {
  if (!tourState.active) return
  const step = tourState.steps[tourState.index]
  const elements = getTourElements(step)
  const rect = getTourTargetRect(elements)
  const layer = document.getElementById("boris-tour")
  const spotlight = layer?.querySelector(".tour-spotlight")
  const callout = layer?.querySelector(".tour-callout")
  if (!rect || !spotlight || !callout) return

  const width = Math.max(0, rect.right - rect.left)
  const height = Math.max(0, rect.bottom - rect.top)
  spotlight.style.transform = `translate(${rect.left}px, ${rect.top}px)`
  spotlight.style.width = `${width}px`
  spotlight.style.height = `${height}px`

  const gap = 14
  const edge = 12
  const calloutWidth = callout.offsetWidth
  const calloutHeight = callout.offsetHeight
  let left
  let top

  if (rect.right + gap + calloutWidth <= window.innerWidth - edge) {
    left = rect.right + gap
    top = rect.top
  } else if (rect.left - gap - calloutWidth >= edge) {
    left = rect.left - gap - calloutWidth
    top = rect.top
  } else if (rect.bottom + gap + calloutHeight <= window.innerHeight - edge) {
    left = rect.left
    top = rect.bottom + gap
  } else {
    left = rect.left
    top = rect.top - gap - calloutHeight
  }

  callout.style.left = `${Math.max(edge, Math.min(left, window.innerWidth - calloutWidth - edge))}px`
  callout.style.top = `${Math.max(edge, Math.min(top, window.innerHeight - calloutHeight - edge))}px`
}

function scheduleTourPosition() {
  window.cancelAnimationFrame(tourState.repositionFrame)
  tourState.repositionFrame = window.requestAnimationFrame(positionTourUi)
}

function applyTourStepActions(step) {
  if (tourState.sidebarOpened && !step.showSidebar) {
    toggleSidebar(false)
    tourState.sidebarOpened = false
  }

  if (step.closeSelector) {
    document.querySelector(step.closeSelector)?.click()
    tourState.openedCleanupSelector = null
  }

  if (step.activateTab) {
    document.querySelector(`[data-notes-tab="${step.activateTab}"]`)?.click()
  }

  if (step.openSelector) {
    document.querySelector(step.openSelector)?.click()
    tourState.openedCleanupSelector = step.cleanupSelector || null
  }

  if (step.showSidebar && window.getComputedStyle(document.getElementById("sidebar-toggle") || document.body).display !== "none") {
    toggleSidebar(true)
    tourState.sidebarOpened = true
  }
}

async function showTourStep(index) {
  if (!tourState.active || index < 0 || index >= tourState.steps.length) return
  tourState.index = index
  const step = tourState.steps[index]
  applyTourStepActions(step)

  const layer = ensureTourUi()
  layer.querySelector("#tour-counter").textContent = `Step ${index + 1} of ${tourState.steps.length}`
  layer.querySelector("#tour-title").textContent = step.title || "Quick tour"
  layer.querySelector("#tour-body").textContent = step.body || ""
  const back = layer.querySelector("#tour-back")
  const next = layer.querySelector("#tour-next")
  back.hidden = index === 0
  next.textContent = index === tourState.steps.length - 1 ? "Done" : "Next"

  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
  const firstVisible = getTourElements(step).find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  firstVisible?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" })
  window.setTimeout(() => {
    positionTourUi()
    next.focus()
  }, 180)
}

function cleanupTourViews() {
  if (tourState.openedCleanupSelector) {
    document.querySelector(tourState.openedCleanupSelector)?.click()
    tourState.openedCleanupSelector = null
  }
  if (tourState.sidebarOpened) {
    toggleSidebar(false)
    tourState.sidebarOpened = false
  }
}

async function finishPageTour() {
  if (!tourState.active || tourState.marking) return
  tourState.active = false
  cleanupTourViews()
  document.getElementById("boris-tour").hidden = true
  window.removeEventListener("resize", scheduleTourPosition)
  window.removeEventListener("scroll", scheduleTourPosition, true)
  document.removeEventListener("keydown", handleTourEscape, true)
  const page = tourState.page
  tourState.visited.add(page)
  renderTourNavDots()
  tourState.marking = true

  try {
    await fetchJson("/api/tour/visited", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page })
    })
  } catch (error) {
    tourState.visited.delete(page)
    renderTourNavDots()
    showToast("Tutorial progress could not be saved.", "error")
  } finally {
    tourState.marking = false
  }
}

function handleTourEscape(event) {
  if (event.key === "Escape" && tourState.active) {
    event.preventDefault()
    event.stopImmediatePropagation()
    finishPageTour()
  }
}

async function initPageTour(page, steps) {
  if (!TOUR_PAGE_HREFS[page] && page !== "dev-logs") return
  const visited = await loadTourVisitedPages()
  renderTourNavDots()
  if (!TOUR_PAGE_HREFS[page] || visited.has(page) || !steps.length) return

  const validSteps = steps.filter((step) => getTourElements(step).length > 0)
  if (!validSteps.length) return
  tourState.page = page
  tourState.steps = validSteps
  tourState.index = 0
  tourState.active = true
  const layer = ensureTourUi()
  layer.hidden = false
  window.addEventListener("resize", scheduleTourPosition)
  window.addEventListener("scroll", scheduleTourPosition, true)
  document.addEventListener("keydown", handleTourEscape, true)
  await showTourStep(0)
}

function formatTimestampLabel(value) {
  if (!value) {
    return "--"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    timeZone: APP_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}


function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Internal links only. The href must start with a single slash, which
    // rejects javascript:, absolute URLs, and protocol-relative //host paths so
    // a model-authored link can never point off-site.
    .replace(/\[([^\]]+)\]\((\/(?!\/)[A-Za-z0-9\-._~/?#[\]@!$&'()*+,;=%]*)\)/g, '<a href="$2">$1</a>')
  }

function renderMarkdown(value) {
  const text = String(value || "").trim()

  if (!text) {
    return ""
  }

  const blocks = text.split(/\n\s*\n/)
  return blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean)

    if (!lines.length) {
      return ""
    }

    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`
    }

    return `<p>${lines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p>`
  }).join("")
}

function isSafeMarkdownUrl(value) {
  const href = String(value || "").trim()
  // Browsers normalize backslashes and embedded control characters in URLs.
  // Reject them before parsing, along with protocol-relative destinations.
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href) || href.startsWith("//")) {
    return false
  }

  try {
    const base = "https://boris.invalid/"
    const url = new URL(href, base)
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
      return ["http:", "https:", "mailto:"].includes(url.protocol)
    }
    return url.origin === new URL(base).origin
  } catch (_error) {
    return false
  }
}

function renderRichMarkdown(value) {
  const text = String(value || "").trim()

  if (!text) {
    return ""
  }

  if (window.marked?.parse) {
    const renderer = new window.marked.Renderer()
    renderer.link = function (token) {
      return isSafeMarkdownUrl(token.href)
        ? window.marked.Renderer.prototype.link.call(this, token)
        : this.parser.parseInline(token.tokens)
    }
    renderer.image = function (token) {
      return isSafeMarkdownUrl(token.href)
        ? window.marked.Renderer.prototype.image.call(this, token)
        : escapeHtml(token.text)
    }
    return window.marked.parse(escapeHtml(text), { renderer })
  }

  return renderMarkdown(text)
}

function getChatThread() {
  return document.getElementById("chat-thread")
}

function nextChatMessageId() {
  chatState.messageCount += 1
  return `chat-message-${chatState.messageCount}`
}

function scrollChatToBottom() {
  const thread = getChatThread()

  if (thread) {
    thread.scrollTop = thread.scrollHeight
  }
}

function parseThreadContent(content) {
  const text = String(content || "").trim()

  if (!text) {
    return []
  }

  const messages = []
  let currentMessage = null

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = String(rawLine || "")
    const trimmed = line.trim()

    if (!trimmed) {
      if (currentMessage) {
        currentMessage.content += "\n"
      }
      return
    }

    if (trimmed.startsWith("# ")) {
      return
    }

    const match = trimmed.match(/^\[(.+?)\]\s+(User|Boris):\s*(.*)$/)

    if (match) {
      if (currentMessage) {
        messages.push(currentMessage)
      }

      currentMessage = {
        role: match[2] === "User" ? "user" : "assistant",
        content: match[3] || ""
      }
      return
    }

    if (currentMessage) {
      currentMessage.content += `\n${line}`
    }
  })

  if (currentMessage) {
    messages.push(currentMessage)
  }

  return messages
}

async function hydrateTodayChatThread() {
  const thread = getChatThread()

  if (!thread) {
    return false
  }

  const response = await fetchJson("/thread/today")
  const messages = parseThreadContent(response?.content)

  if (!messages.length) {
    return false
  }

  thread.innerHTML = ""
  chatState.conversation = []
  chatState.messageCount = 0

  messages.forEach((message) => {
    createChatMessage(message.role, message.content, {
      markdown: message.role === "assistant"
    })
  })

  scrollChatToBottom()
  return true
}

function setChatMode(mode) {
  chatState.mode = mode

  const indicator = document.getElementById("chat-mode-indicator")
  const text = document.getElementById("chat-mode-text")
  const composerLabel = document.getElementById("composer-mode-label")
  const startRecapButton = document.getElementById("start-recap-button")
  const exitRecapButton = document.getElementById("exit-recap-button")
  const next = {
    free: {
      className: "mode-free",
      label: "Free Chat"
    },
    recap: {
      className: "mode-recap",
      label: "Daily Recap"
    },
    doctor: {
      className: "mode-doctor",
      label: "Doctor Mode"
    }
  }[mode] || {
    className: "mode-free",
    label: "Free Chat"
  }

  if (indicator) {
    indicator.classList.remove("mode-free", "mode-recap", "mode-doctor")
    indicator.classList.add(next.className)
  }

  if (text) {
    text.textContent = next.label
  }

  if (composerLabel) {
    composerLabel.textContent = next.label
  }

  if (startRecapButton) {
    startRecapButton.hidden = mode === "recap"
  }

  if (exitRecapButton) {
    exitRecapButton.hidden = mode !== "recap"
  }
}

function setChatPending(pending) {
  chatState.pending = Boolean(pending)
  const input = document.getElementById("chat-input")
  const sendButton = document.getElementById("chat-send-button")
  const recapButton = document.getElementById("start-recap-button")

  if (input) {
    input.disabled = chatState.pending
  }

  if (sendButton) {
    sendButton.disabled = chatState.pending
    sendButton.textContent = chatState.pending ? "Sending..." : "Send"
  }

  if (recapButton) {
    recapButton.disabled = chatState.pending
  }
}

function setChatError(message) {
  const node = document.getElementById("chat-error")

  if (node) {
    node.textContent = message || ""
  }
}

function pushConversation(role, content) {
  const normalized = String(content || "").trim()

  if (!normalized) {
    return
  }

  chatState.conversation.push({ role, content: normalized })
  chatState.conversation = chatState.conversation.slice(-24)
  chatState.sessionEndSent = false
}

function createChatMessage(role, content, options = {}) {
  const thread = getChatThread()

  if (!thread) {
    return null
  }

  const messageId = nextChatMessageId()
  const article = document.createElement("article")
  const bubble = document.createElement("div")
  const body = document.createElement("div")

  article.className = `chat-message ${role === "user" ? "chat-message-user" : "chat-message-assistant"}`
  article.dataset.messageId = messageId

  bubble.className = "chat-bubble"
  body.className = "chat-bubble-body"

  if (options.typing) {
    bubble.classList.add("chat-bubble-typing")
    body.innerHTML = `
      <span class="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </span>
    `
  } else if (options.markdown) {
    body.innerHTML = renderMarkdown(content)
  } else {
    body.textContent = content
  }

  bubble.appendChild(body)

  if (options.answerSummary) {
    const summary = document.createElement("p")
    summary.className = "chat-answer-summary"
    summary.textContent = options.answerSummary
    bubble.appendChild(summary)
  }

  article.appendChild(bubble)

  if (role === "assistant" && options.modeLabel) {
    const meta = document.createElement("div")
    meta.className = `chat-message-meta ${options.modeTone ? `chat-message-meta-${options.modeTone}` : ""}`
    meta.textContent = options.modeLabel
    article.appendChild(meta)
  }

  if (options.question) {
    article.appendChild(renderInteractiveQuestion(options.question, messageId))
  }

  thread.appendChild(article)
  scrollChatToBottom()

  if (options.addToConversation !== false && !options.typing) {
    pushConversation(role, content)
  }

  return article
}

function removeTypingIndicator() {
  if (!chatState.typingMessageId) {
    return
  }

  const node = document.querySelector(`[data-message-id="${chatState.typingMessageId}"]`)
  node?.remove()
  chatState.typingMessageId = null
}

function showTypingIndicator() {
  removeTypingIndicator()
  const node = createChatMessage("assistant", "", {
    typing: true,
    addToConversation: false
  })

  if (node) {
    chatState.typingMessageId = node.dataset.messageId
  }
}

function setRecapState(nextState) {
  chatState.recapState = {
    active: Boolean(nextState?.active),
    coveredFields: Array.isArray(nextState?.coveredFields) ? nextState.coveredFields : [],
    startedAt: nextState?.startedAt || null,
    interrupted: Boolean(nextState?.interrupted),
    currentQuestion: nextState?.currentQuestion || null
  }
}

function resetRecapState() {
  setRecapState({
    active: false,
    coveredFields: [],
    startedAt: null,
    interrupted: false,
    currentQuestion: null
  })
}

function buildAnswerText(question, answer) {
  if (!question) {
    return String(answer || "").trim()
  }

  if (question.type === "yes_no") {
    return String(answer || "").toLowerCase() === "yes" || answer === true ? "Yes" : "No"
  }

  if (question.type === "checkbox") {
    return Array.isArray(answer) && answer.length ? answer.join(", ") : "None"
  }

  if (question.type === "slider") {
    if (!question.sliders?.length) {
      return String(answer || "")
    }

    return question.sliders.map((slider) => {
      const value = isObject(answer) ? answer[slider.field] : answer
      return `${slider.label}: ${value}`
    }).join(", ")
  }

  return String(answer || "").trim()
}

function collapseInteractiveQuestion(messageId, summaryText) {
  const message = document.querySelector(`[data-message-id="${messageId}"]`)
  const interaction = message?.querySelector(".chat-interaction")

  if (!message || !interaction) {
    return
  }

  interaction.remove()

  const summary = document.createElement("p")
  summary.className = "chat-answer-summary"
  summary.textContent = summaryText
  message.querySelector(".chat-bubble")?.appendChild(summary)
}

function renderInteractiveQuestion(question, messageId) {
  const container = document.createElement("div")
  container.className = "chat-interaction"
  container.dataset.questionKey = question.key

  if (question.type === "yes_no") {
    const row = document.createElement("div")
    row.className = "chat-pill-row"

    ;["Yes", "No"].forEach((label) => {
      const button = document.createElement("button")
      button.className = "chat-pill-button"
      button.type = "button"
      button.textContent = label
      button.addEventListener("click", () => {
        submitRecapAnswer(question, label.toLowerCase(), messageId)
      })
      row.appendChild(button)
    })

    container.appendChild(row)
    return container
  }

  if (question.type === "multiple_choice") {
    const row = document.createElement("div")
    row.className = "chat-pill-row"

    ;(question.options || []).forEach((option) => {
      const button = document.createElement("button")
      button.className = "chat-pill-button"
      button.type = "button"
      button.textContent = option
      button.addEventListener("click", () => {
        submitRecapAnswer(question, option, messageId)
      })
      row.appendChild(button)
    })

    container.appendChild(row)
    return container
  }

  if (question.type === "checkbox") {
    const list = document.createElement("div")
    list.className = "chat-checkbox-list"

    ;(question.options || []).forEach((option) => {
      const label = document.createElement("label")
      const input = document.createElement("input")
      const text = document.createElement("span")

      label.className = "chat-checkbox"
      input.type = "checkbox"
      input.value = option
      text.textContent = option

      label.appendChild(input)
      label.appendChild(text)
      list.appendChild(label)
    })

    const doneButton = document.createElement("button")
    doneButton.type = "button"
    doneButton.className = "button-secondary chat-inline-submit"
    doneButton.textContent = "Done"
    doneButton.addEventListener("click", () => {
      const selected = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value)
      submitRecapAnswer(question, selected, messageId)
    })

    container.appendChild(list)
    container.appendChild(doneButton)
    return container
  }

  if (question.type === "slider") {
    const selections = {}

    ;(question.sliders || []).forEach((slider) => {
      const group = document.createElement("div")
      const label = document.createElement("div")
      const row = document.createElement("div")

      group.className = "chat-slider-group"
      label.className = "chat-slider-label"
      row.className = "chat-slider-row"
      label.textContent = slider.label

      slider.options.forEach((option) => {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "chat-scale-button"
        button.textContent = String(option)
        button.addEventListener("click", () => {
          selections[slider.field] = option
          row.querySelectorAll(".chat-scale-button").forEach((node) => {
            node.classList.toggle("is-selected", node === button)
          })
          doneButton.disabled = (question.sliders || []).some((item) => selections[item.field] === undefined)
        })
        row.appendChild(button)
      })

      group.appendChild(label)
      group.appendChild(row)
      container.appendChild(group)
    })

    const doneButton = document.createElement("button")
    doneButton.type = "button"
    doneButton.className = "button-secondary chat-inline-submit"
    doneButton.disabled = true
    doneButton.textContent = "Done"
    doneButton.addEventListener("click", () => {
      submitRecapAnswer(question, selections, messageId)
    })

    container.appendChild(doneButton)
    return container
  }

  const form = document.createElement("form")
  const input = document.createElement("input")
  const button = document.createElement("button")

  form.className = "chat-inline-form"
  input.className = "chat-inline-input"
  input.type = "text"
  input.placeholder = question.placeholder || "Type your answer"
  button.className = "button-secondary chat-inline-submit"
  button.type = "submit"
  button.textContent = "Submit"

  form.addEventListener("submit", (event) => {
    event.preventDefault()
    submitRecapAnswer(question, input.value.trim(), messageId)
  })

  form.appendChild(input)
  form.appendChild(button)
  container.appendChild(form)
  return container
}

function updateChatModeFromServer(nextMode, recapDone) {
  if (nextMode === "doctor") {
    resetRecapState()
    setChatMode("doctor")
    return
  }

  if (nextMode === "free" || recapDone) {
    resetRecapState()
    setChatMode("free")
    return
  }

  if (nextMode === "recap") {
    setChatMode("recap")
  }
}

function getAssistantModeMeta(type, activeMode) {
  if (type === "question") {
    return {
      label: "Doctor Mode",
      tone: "doctor"
    }
  }

  if (type === "meta") {
    return {
      label: "Meta",
      tone: "meta"
    }
  }

  if (type === "identity_update") {
    return {
      label: "Identity Update",
      tone: "identity"
    }
  }

  if (type === "automation") {
    return {
      label: "Automation",
      tone: "automation"
    }
  }

  if (activeMode === "recap" || type === "recap_answer") {
    return {
      label: "Daily Recap",
      tone: "recap"
    }
  }

  if (activeMode === "doctor") {
    return {
      label: "Doctor Mode",
      tone: "doctor"
    }
  }

  return {
    label: "Log Mode",
    tone: "log"
  }
}

async function submitRecapAnswer(question, lastAnswer, messageId) {
  if (chatState.pending) {
    return
  }

  const answerText = buildAnswerText(question, lastAnswer)
  setChatError("")
  setChatPending(true)
  pushConversation("user", answerText)
  showTypingIndicator()

  try {
    const response = await fetchJson("/recap/next", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recapState: {
          ...chatState.recapState,
          currentQuestion: question
        },
        lastAnswer
      })
    })

    collapseInteractiveQuestion(messageId, answerText)
    removeTypingIndicator()

    if (response.response) {
      const modeMeta = getAssistantModeMeta(response.type, chatState.mode)
      createChatMessage("assistant", response.response, {
        markdown: response.type === "question" || response.type === "automation",
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }

    if (response.recapState) {
      setRecapState(response.recapState)
    }

    if (response.nextMode || response.recapDone) {
      updateChatModeFromServer(response.nextMode, response.recapDone)
    }

    if (response.nextQuestion) {
      setRecapState({
        ...chatState.recapState,
        active: true,
        currentQuestion: response.nextQuestion
      })
      const modeMeta = getAssistantModeMeta("recap_answer", "recap")
      createChatMessage("assistant", response.nextQuestion.question, {
        question: response.nextQuestion,
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }
  } catch (error) {
    removeTypingIndicator()
    createChatMessage("assistant", "Sorry, I'm having trouble connecting right now. Try again in a moment.")
    setChatError(error.message)
  } finally {
    setChatPending(false)
  }
}

async function handleChatSubmit(event) {
  event.preventDefault()

  if (chatState.pending) {
    return
  }

  const input = document.getElementById("chat-input")
  const message = input?.value.trim()

  if (!message) {
    return
  }

  setChatError("")
  createChatMessage("user", message)
  input.value = ""
  setChatPending(true)
  showTypingIndicator()

  const requestMode = chatState.recapState.active ? "recap" : chatState.mode

  try {
    const response = await fetchJson("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        mode: requestMode,
        recapState: chatState.recapState,
        conversation: chatState.conversation
      })
    })

    removeTypingIndicator()

    if (response.response) {
      const modeMeta = getAssistantModeMeta(response.type, requestMode)
      createChatMessage("assistant", response.response, {
        markdown: response.type === "question" || response.type === "automation",
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }

    if (requestMode === "recap" && response.type === "question" && response.nextQuestion) {
      setRecapState({
        ...chatState.recapState,
        active: true,
        interrupted: true,
        currentQuestion: response.nextQuestion
      })
      const modeMeta = getAssistantModeMeta("recap_answer", "recap")
      createChatMessage("assistant", response.nextQuestion.question, {
        question: response.nextQuestion,
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
      return
    }

    if (response.nextMode || response.recapDone) {
      updateChatModeFromServer(response.nextMode, response.recapDone)
    }

    if (response.nextQuestion) {
      setRecapState({
        ...chatState.recapState,
        active: true,
        interrupted: false,
        currentQuestion: response.nextQuestion
      })
      setChatMode("recap")
      const modeMeta = getAssistantModeMeta("recap_answer", "recap")
      createChatMessage("assistant", response.nextQuestion.question, {
        question: response.nextQuestion,
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }
  } catch (error) {
    removeTypingIndicator()
    createChatMessage("assistant", "Sorry, I'm having trouble connecting right now. Try again in a moment.")
    setChatError(error.message)
  } finally {
    setChatPending(false)
  }
}

async function startDailyRecapFlow() {
  if (chatState.pending) {
    return
  }

  setChatError("")
  setChatPending(true)
  showTypingIndicator()

  try {
    const response = await fetchJson("/recap/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    })

    removeTypingIndicator()
    setChatMode("recap")
    setRecapState(response.recapState)

    if (response.response) {
      const modeMeta = getAssistantModeMeta("recap_answer", "recap")
      createChatMessage("assistant", response.response, {
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }

    if (response.nextQuestion) {
      setRecapState({
        ...response.recapState,
        active: true,
        currentQuestion: response.nextQuestion
      })
      const modeMeta = getAssistantModeMeta("recap_answer", "recap")
      createChatMessage("assistant", response.nextQuestion.question, {
        question: response.nextQuestion,
        modeLabel: modeMeta.label,
        modeTone: modeMeta.tone
      })
    }
  } catch (error) {
    removeTypingIndicator()
    createChatMessage("assistant", "Sorry, I'm having trouble connecting right now. Try again in a moment.")
    setChatError(error.message)
  } finally {
    setChatPending(false)
  }
}

function exitDailyRecap() {
  if (!chatState.recapState.active && chatState.mode !== "recap") {
    setChatMode("free")
    return
  }

  resetRecapState()
  setChatMode("free")
  createChatMessage(
    "assistant",
    "Recap exited. We’re back in free chat whenever you want to continue."
  )
}

function sendChatSessionEndSilently() {
  if (chatState.sessionEndSent || !chatState.conversation.length) {
    return
  }

  chatState.sessionEndSent = true
  const payload = JSON.stringify({
    conversationHistory: chatState.conversation
  })

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" })
      navigator.sendBeacon("/chat/endsession", blob)
      return
    }
  } catch (_error) {
    // Fall back to fetch keepalive below.
  }

  fetch("/chat/endsession", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: payload,
    keepalive: true
  }).catch(() => {})
}

async function setupChat() {
  await setupShellPage()
  setChatMode("free")
  const hydrated = await hydrateTodayChatThread().catch(() => false)

  if (!hydrated) {
    createChatMessage(
      "assistant",
      "I can log updates, answer questions about your health patterns, or walk through a daily recap when you're ready.",
      {
        modeLabel: "Log Mode",
        modeTone: "log"
      }
    )
  }

  document.getElementById("chat-form")?.addEventListener("submit", handleChatSubmit)
  document.getElementById("start-recap-button")?.addEventListener("click", startDailyRecapFlow)
  document.getElementById("exit-recap-button")?.addEventListener("click", exitDailyRecap)
  window.addEventListener("beforeunload", sendChatSessionEndSilently)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendChatSessionEndSilently()
    }
  })
}

async function loadIdentityView() {
  const response = await fetchText("/identity", {
    headers: {
      Accept: "text/markdown",
      "X-Boris-Content": "markdown"
    }
  })
  notesState.identityText = response.text
  document.getElementById("identity-updated").textContent = `Last updated: ${formatTimestampLabel(response.lastUpdated)}`
  document.getElementById("identity-content").innerHTML = renderRichMarkdown(response.text)
  document.getElementById("identity-input").value = response.text
}

async function loadHealthPictureView() {
  const response = await fetchText("/health-picture", {
    headers: {
      Accept: "text/markdown",
      "X-Boris-Content": "markdown"
    }
  })
  notesState.healthPictureText = response.text
  document.getElementById("health-picture-updated").textContent = `Last updated: ${formatTimestampLabel(response.lastUpdated)}`
  document.getElementById("health-picture-content").innerHTML = renderRichMarkdown(response.text)
  document.getElementById("health-picture-input").value = response.text
}

function renderSummaryEmptyState(listId, detailId, message) {
  const list = document.getElementById(listId)
  const detail = document.getElementById(detailId)

  if (list) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`
  }

  if (detail) {
    detail.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`
  }
}

async function loadSummaryDetail(type, fileName, detailId) {
  const detail = document.getElementById(detailId)

  if (!detail) {
    return
  }

  detail.innerHTML = '<div class="empty-state">Loading summary...</div>'

  try {
    const response = await fetchJson(`/summaries/${type}/${encodeURIComponent(fileName)}`)
    const listItem = notesState.summaries?.[type]?.find((item) => item.fileName === (response.fileName || fileName))
    const detailKey = `${type}:${response.fileName || fileName}`
    notesState.summaryDetails[detailKey] = {
      ...response,
      label: listItem?.label || response.period || response.fileName
    }
    renderSummaryDetailCard(detailId, notesState.summaryDetails[detailKey])
  } catch (error) {
    detail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`
  }
}

function setNotesEditorMode(kind, editing) {
  const view = document.getElementById(`${kind}-view`)
  const form = document.getElementById(`${kind}-form`)
  const toggle = document.getElementById(`${kind}-edit-toggle`)
  const status = document.getElementById(`${kind}-status`)

  if (view) {
    view.hidden = editing
  }

  if (form) {
    form.hidden = !editing
  }

  if (toggle) {
    toggle.textContent = editing ? "Editing" : "Edit"
    toggle.disabled = editing
  }

  if (!editing && status) {
    status.textContent = ""
  }
}

function getSummaryBadge(item) {
  if (item?.editedManually) {
    return '<span class="notes-badge notes-badge-edited">Edited manually</span>'
  }

  return '<span class="notes-badge notes-badge-generated">Generated summary</span>'
}

function renderSummaryDetailCard(detailId, item) {
  const detail = document.getElementById(detailId)

  if (!detail || !item) {
    return
  }

  detail.innerHTML = `
    <div class="notes-summary-shell" data-detail-summary-type="${escapeAttribute(item.type || "")}" data-detail-summary-file="${escapeAttribute(item.fileName || `${item.period}.md`)}">
    <div class="notes-summary-header">
      <div>
        <h4>${escapeHtml(item.label || item.period || item.fileName || "Summary")}</h4>
        <p class="notes-meta">Updated: ${escapeHtml(formatTimestampLabel(item.createdAt))}</p>
      </div>
      <div class="notes-panel-actions">
        ${getSummaryBadge(item)}
        <button class="mini-button" type="button" data-summary-edit-toggle="${escapeAttribute(detailId)}" data-edit-summary-type="${escapeAttribute(item.type || "")}" data-edit-summary-file="${escapeAttribute(item.fileName || `${item.period}.md`)}">Edit</button>
      </div>
    </div>
    <div id="${detailId}-view" class="notes-document-view">
      <div class="notes-markdown-card">${renderRichMarkdown(item.content || "")}</div>
    </div>
    <form id="${detailId}-form" class="stack-form notes-inline-editor" hidden>
      <textarea id="${detailId}-input" rows="16" placeholder="Edit summary">${escapeHtml(item.content || "")}</textarea>
      <div class="notes-editor-actions">
        <button class="button-primary" type="submit">Save</button>
        <button class="mini-button" type="button" data-summary-cancel="${escapeAttribute(detailId)}">Cancel</button>
      </div>
      <p id="${detailId}-status" class="status-text"></p>
    </form>
    </div>
  `
}

function setSummaryEditorMode(detailId, editing) {
  const view = document.getElementById(`${detailId}-view`)
  const form = document.getElementById(`${detailId}-form`)
  const toggle = document.querySelector(`[data-summary-edit-toggle="${detailId}"]`)
  const status = document.getElementById(`${detailId}-status`)

  if (view) {
    view.hidden = editing
  }

  if (form) {
    form.hidden = !editing
  }

  if (toggle) {
    toggle.textContent = editing ? "Editing" : "Edit"
    toggle.disabled = editing
  }

  if (!editing && status) {
    status.textContent = ""
  }
}

function renderSummaryList(type, listId, detailId, emptyMessage, options = {}) {
  const items = Array.isArray(notesState.summaries?.[type]) ? notesState.summaries[type] : []
  const list = document.getElementById(listId)

  if (!list) {
    return
  }

  if (!items.length) {
    renderSummaryEmptyState(listId, detailId, emptyMessage)
    return
  }

  if (options.groupByMonth) {
    const groups = items.reduce((accumulator, item) => {
      const key = item.monthKey || "other"
      accumulator[key] = accumulator[key] || {
        key,
        monthLabel: item.monthLabel || key,
        items: []
      }
      accumulator[key].items.push(item)
      return accumulator
    }, {})

    list.innerHTML = Object.values(groups)
      .sort((left, right) => right.key.localeCompare(left.key))
      .map((group) => `
        <details class="summary-group">
          <summary>${escapeHtml(group.monthLabel)} (${group.items.length} summaries)</summary>
          <div class="summary-group-list">
            ${group.items.map((item) => `
              <button class="summary-link-button" type="button" data-summary-type="${type}" data-summary-file="${escapeAttribute(item.fileName)}" data-summary-detail="${detailId}">
                <span>${escapeHtml(item.label)}</span>
                ${item.editedManually ? '<span class="summary-link-state">Edited</span>' : ""}
              </button>
            `).join("")}
          </div>
        </details>
      `)
      .join("")
  } else {
    list.innerHTML = items.map((item) => `
      <button class="summary-link-button" type="button" data-summary-type="${type}" data-summary-file="${escapeAttribute(item.fileName)}" data-summary-detail="${detailId}">
        <span>${escapeHtml(item.label)}</span>
        ${item.editedManually ? '<span class="summary-link-state">Edited</span>' : ""}
      </button>
    `).join("")
  }

  document.getElementById(detailId).innerHTML = '<div class="empty-state">Select a summary to read it here.</div>'
}

async function ensureSummariesLoaded() {
  if (!notesState.summaries) {
    notesState.summaries = await fetchJson("/summaries/list")
  }
}

async function loadNotesTab(tab) {
  if (tab === "identity") {
    await loadIdentityView()
    return
  }

  if (tab === "health-picture") {
    await loadHealthPictureView()
    return
  }

  await ensureSummariesLoaded()

  if (tab === "daily") {
    renderSummaryList(
      "daily",
      "daily-summary-list",
      "daily-summary-detail",
      "Daily summaries will appear here after your first night. Boris generates them automatically at 3am.",
      { groupByMonth: true }
    )
  }

  if (tab === "weekly") {
    renderSummaryList(
      "weekly",
      "weekly-summary-list",
      "weekly-summary-detail",
      "Weekly summaries will appear here once Boris has enough data to generate them."
    )
  }

  if (tab === "monthly") {
    renderSummaryList(
      "monthly",
      "monthly-summary-list",
      "monthly-summary-detail",
      "Monthly summaries will appear here once Boris has enough data to generate them."
    )
  }

  if (tab === "quarterly-yearly") {
    renderSummaryList(
      "quarterly",
      "quarterly-summary-list",
      "quarterly-summary-detail",
      "Quarterly summaries will appear here after Boris has enough history."
    )
    renderSummaryList(
      "yearly",
      "yearly-summary-list",
      "yearly-summary-detail",
      "Yearly summaries will appear here after Boris has enough history."
    )
  }
}

function setNotesTab(tab) {
  notesState.activeTab = tab
  document.querySelectorAll("[data-notes-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.notesTab === tab)
  })
  document.querySelectorAll(".notes-panel").forEach((panel) => {
    panel.hidden = panel.id !== `notes-panel-${tab}`
  })

  loadNotesTab(tab).catch((error) => {
    console.error("[Boris UI] Failed to load notes tab", error)
  })
}

async function saveMarkdownEditor({ inputId, submitId, statusId, endpoint, reload }) {
  const input = document.getElementById(inputId)
  const submit = document.getElementById(submitId)
  const status = document.getElementById(statusId)
  const content = input?.value || ""

  if (!input || !submit || !status) {
    return
  }

  submit.disabled = true
  status.textContent = "Saving..."

  try {
    await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    })

    status.textContent = "Saved."
    await reload()
  } catch (error) {
    status.textContent = error.message
  } finally {
    submit.disabled = false
  }
}

async function setupNotesPage() {
  await setupShellPage()
  setupSummaryButton()
  document.querySelectorAll("[data-notes-tab]").forEach((button) => {
    button.addEventListener("click", () => setNotesTab(button.dataset.notesTab))
  })

  document.getElementById("identity-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    await saveMarkdownEditor({
      inputId: "identity-input",
      submitId: "identity-submit",
      statusId: "identity-status",
      endpoint: "/identity/update",
      reload: async () => {
        await loadIdentityView()
        setNotesEditorMode("identity", false)
      }
    })
  })

  document.getElementById("health-picture-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    await saveMarkdownEditor({
      inputId: "health-picture-input",
      submitId: "health-picture-submit",
      statusId: "health-picture-status",
      endpoint: "/health-picture/update",
      reload: async () => {
        await loadHealthPictureView()
        setNotesEditorMode("health-picture", false)
      }
    })
  })

  document.getElementById("identity-edit-toggle")?.addEventListener("click", () => {
    document.getElementById("identity-input").value = notesState.identityText
    setNotesEditorMode("identity", true)
  })

  document.getElementById("health-picture-edit-toggle")?.addEventListener("click", () => {
    document.getElementById("health-picture-input").value = notesState.healthPictureText
    setNotesEditorMode("health-picture", true)
  })

  document.getElementById("health-picture-regenerate")?.addEventListener("click", async () => {
    const button = document.getElementById("health-picture-regenerate")
    const status = document.getElementById("health-picture-regenerate-status")

    if (!button || !status) {
      return
    }

    button.disabled = true
    button.textContent = "Regenerating..."
    status.textContent = ""

    try {
      const response = await fetchJson("/health-picture/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      })

      notesState.healthPictureText = response.content || ""
      document.getElementById("health-picture-content").innerHTML = renderRichMarkdown(response.content || "")
      document.getElementById("health-picture-input").value = response.content || ""
      status.textContent = "Health picture regenerated."
      await loadHealthPictureView()
    } catch (error) {
      status.textContent = error.message || "Could not regenerate the health picture."
    } finally {
      button.disabled = false
      button.textContent = "Regenerate Health Picture"
    }
  })

  document.getElementById("identity-cancel")?.addEventListener("click", () => {
    document.getElementById("identity-input").value = notesState.identityText
    setNotesEditorMode("identity", false)
  })

  document.getElementById("health-picture-cancel")?.addEventListener("click", () => {
    document.getElementById("health-picture-input").value = notesState.healthPictureText
    setNotesEditorMode("health-picture", false)
  })

  document.body.addEventListener("click", (event) => {
    const button = event.target?.closest("[data-summary-file]")

    if (button) {
      loadSummaryDetail(
        button.dataset.summaryType,
        button.dataset.summaryFile,
        button.dataset.summaryDetail
      ).catch((error) => {
        console.error("[Boris UI] Failed to load summary detail", error)
      })
      return
    }

    const editToggle = event.target?.closest("[data-summary-edit-toggle]")

    if (editToggle) {
      const detailId = editToggle.dataset.summaryEditToggle
      const type = editToggle.dataset.editSummaryType
      const fileName = editToggle.dataset.editSummaryFile
      const cacheKey = `${type}:${fileName}`
      const item = notesState.summaryDetails[cacheKey]

      if (item) {
        document.getElementById(`${detailId}-input`).value = item.content || ""
      }

      setSummaryEditorMode(detailId, true)
      return
    }

    const cancel = event.target?.closest("[data-summary-cancel]")

    if (cancel) {
      const detailId = cancel.dataset.summaryCancel
      const input = document.getElementById(`${detailId}-input`)
      const detailShell = document.getElementById(detailId)?.querySelector(".notes-summary-shell")

      if (input && detailShell) {
        const cacheKey = `${detailShell.dataset.detailSummaryType}:${detailShell.dataset.detailSummaryFile}`
        input.value = notesState.summaryDetails[cacheKey]?.content || ""
      }

      setSummaryEditorMode(detailId, false)
    }
  })

  document.body.addEventListener("submit", async (event) => {
    const form = event.target?.closest(".notes-summary-detail-card form")

    if (!form) {
      return
    }

    event.preventDefault()
    const detailId = form.id.replace(/-form$/, "")
    const detailCard = document.getElementById(detailId)
    const status = document.getElementById(`${detailId}-status`)
    const input = document.getElementById(`${detailId}-input`)
    const detailShell = detailCard?.querySelector(".notes-summary-shell")
    const submit = form.querySelector('button[type="submit"]')

    if (!detailCard || !status || !input || !detailShell || !submit) {
      return
    }

    submit.disabled = true
    status.textContent = "Saving..."

    try {
      const response = await fetchJson(
        `/summaries/${detailShell.dataset.detailSummaryType}/${encodeURIComponent(detailShell.dataset.detailSummaryFile)}/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: input.value
          })
        }
      )

      const cacheKey = `${detailShell.dataset.detailSummaryType}:${detailShell.dataset.detailSummaryFile}`
      const listItem = notesState.summaries?.[detailShell.dataset.detailSummaryType]?.find(
        (item) => item.fileName === detailShell.dataset.detailSummaryFile
      )

      if (listItem) {
        listItem.editedManually = true
        listItem.createdAt = response.createdAt || listItem.createdAt
      }

      notesState.summaryDetails[cacheKey] = {
        ...response,
        label: listItem?.label || response.period
      }
      renderSummaryDetailCard(detailId, notesState.summaryDetails[cacheKey])
      setSummaryEditorMode(detailId, false)
      showToast("Summary saved.", "success")
    } catch (error) {
      status.textContent = error.message
    } finally {
      submit.disabled = false
    }
  })

  await loadNotesTab(notesState.activeTab)
}

function setRecordsTab(type) {
  recordsState.activeType = type
  recordsState.notice = ""
  document.querySelectorAll("[data-records-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.recordsTab === type)
  })

  const meta = getRecordTypeMeta(type)
  const openButton = document.getElementById("records-open-upload")
  const medicationNameLabel = document.getElementById("records-medication-name-label")
  const medicationPurposeLabel = document.getElementById("records-medication-purpose-label")
  const saveMedicationButton = document.getElementById("records-prescription-save")
  const medicationNameInput = document.getElementById("records-prescription-name")
  const medicationPurposeInput = document.getElementById("records-prescription-purpose")
  const medicationTerm = getMedicationTerm(type)
  const isDoctorVisit = isDoctorVisitRecordType(type)
  document.getElementById("records-upload-title").textContent = meta.uploadTitle
  document.getElementById("records-upload-subtitle").textContent = meta.uploadSubtitle
  document.getElementById("records-viewer-title").textContent = meta.viewerTitle
  document.getElementById("records-doctor-text-field").hidden = !isDoctorVisit
  document.getElementById("records-date-label").textContent = isDoctorVisit ? "Visit Date" : "Lab Work Date"
  document.getElementById("records-source-label").textContent = isDoctorVisit ? "Provider or Practice" : "Source"
  document.getElementById("records-source").placeholder = isDoctorVisit ? "Dr. Smith, Johns Hopkins" : "Labcorp, Quest, My doctor"
  document.getElementById("records-extract-button").textContent = isDoctorVisit ? "Create Visit Summary" : "Upload and Extract"

  if (openButton) {
    openButton.textContent = isMedicationRecordType(type)
      ? `Add ${medicationTerm}`
      : isDoctorVisit
        ? "Add Visit"
        : "Upload"
  }

  if (medicationNameLabel) {
    medicationNameLabel.textContent = `${medicationTerm} Name`
  }

  if (medicationPurposeLabel) {
    medicationPurposeLabel.textContent = "What It's For"
  }

  if (saveMedicationButton) {
    saveMedicationButton.textContent = `Save ${medicationTerm}`
  }

  if (medicationNameInput) {
    medicationNameInput.placeholder = type === "supplement" ? "Vitamin D" : "Lisinopril"
  }

  if (medicationPurposeInput) {
    medicationPurposeInput.placeholder = type === "supplement"
      ? "Energy, sleep, digestion"
      : "ADHD, hair loss, blood pressure"
  }
}

function updateRecordsSelectedFileUi() {
  const selectedFile = document.getElementById("records-selected-file")
  const clearButton = document.getElementById("records-clear-file")
  const dropzone = document.getElementById("records-dropzone")

  if (selectedFile) {
    selectedFile.textContent = recordsState.selectedFile
      ? recordsState.selectedFile.name
      : "No file selected yet."
  }

  if (clearButton) {
    clearButton.hidden = !recordsState.selectedFile
  }

  if (dropzone) {
    dropzone.classList.toggle("has-file", Boolean(recordsState.selectedFile))
  }
}

function openRecordsUploadModal() {
  const modal = document.getElementById("records-upload-modal")

  if (!modal) {
    return
  }

  document.getElementById("records-upload-view").hidden = isMedicationRecordType(recordsState.activeType)
  document.getElementById("records-prescription-view").hidden = !isPrescriptionRecordType(recordsState.activeType)
  document.getElementById("records-supplement-view").hidden = !isSupplementRecordType(recordsState.activeType)
  document.getElementById("records-confirmation-view").hidden = true
  modal.hidden = false
  document.body.classList.add("records-modal-open")
}

function closeRecordsUploadModal() {
  const modal = document.getElementById("records-upload-modal")

  if (!modal) {
    return
  }

  modal.hidden = true
  document.body.classList.remove("records-modal-open")
}

function resetRecordsUploadState() {
  recordsState.selectedFile = null
  recordsState.supplementScanFile = null
  recordsState.pendingExtraction = null
  document.getElementById("records-upload-view").hidden = isMedicationRecordType(recordsState.activeType)
  document.getElementById("records-prescription-view").hidden = !isPrescriptionRecordType(recordsState.activeType)
  document.getElementById("records-supplement-view").hidden = !isSupplementRecordType(recordsState.activeType)
  document.getElementById("records-confirmation-view").hidden = true
  document.getElementById("records-file-input").value = ""
  document.getElementById("records-doctor-text").value = ""
  document.getElementById("records-upload-status").textContent = ""
  document.getElementById("records-prescription-status").textContent = ""
  document.getElementById("records-supplement-status").textContent = ""
  document.getElementById("records-supplement-scan-status").textContent = ""
  document.getElementById("records-save-status").textContent = ""
  document.getElementById("records-prescription-name").value = ""
  document.getElementById("records-prescription-dose").value = ""
  document.getElementById("records-prescription-frequency").value = ""
  document.getElementById("records-prescription-time-of-day").value = ""
  document.getElementById("records-prescription-purpose").value = ""
  document.getElementById("records-prescription-notes").value = ""
  document.getElementById("records-prescription-active").checked = true
  document.getElementById("records-supplement-file-input").value = ""
  document.getElementById("records-supplement-name").value = ""
  document.getElementById("records-supplement-brand").value = ""
  document.getElementById("records-supplement-form-factor").value = ""
  document.getElementById("records-supplement-serving-size").value = ""
  document.getElementById("records-supplement-dose").value = ""
  document.getElementById("records-supplement-frequency").value = ""
  document.getElementById("records-supplement-time-of-day").value = ""
  document.getElementById("records-supplement-purpose").value = ""
  document.getElementById("records-supplement-suggested-use").value = ""
  document.getElementById("records-supplement-notes").value = ""
  document.getElementById("records-supplement-active").checked = true
  renderSupplementIngredientsEditor("records-supplement-ingredients", [createEmptySupplementIngredient()])
  updateRecordsSelectedFileUi()
  updateSupplementScanUi()
}

function closeRecordsCardMenu() {
  if (!recordsState.openMenuRecordId) {
    return
  }

  recordsState.openMenuRecordId = null
  renderRecordsTimeline()
}

function normalizeSupplementIngredients(ingredients) {
  const normalized = Array.isArray(ingredients)
    ? ingredients.map((ingredient) => ({
        name: String(ingredient?.name || "").trim(),
        amount: String(ingredient?.amount || "").trim(),
        unit: String(ingredient?.unit || "").trim(),
        dailyValuePercent: String(ingredient?.dailyValuePercent || "").trim()
      }))
        .filter((ingredient) => ingredient.name || ingredient.amount || ingredient.unit || ingredient.dailyValuePercent)
    : []

  return normalized.length ? normalized : [createEmptySupplementIngredient()]
}

function renderSupplementIngredientsEditor(containerId, ingredients, options = {}) {
  const container = document.getElementById(containerId)

  if (!container) {
    return
  }

  const { edit = false } = options
  const rows = normalizeSupplementIngredients(ingredients)
  const fieldPrefix = edit ? "data-record-edit-ingredient-field" : "data-supplement-ingredient-field"

  container.innerHTML = rows.map((ingredient, index) => `
    <div class="records-ingredient-row">
      <input class="records-cell-input" type="text" placeholder="Ingredient" ${fieldPrefix}="name" data-ingredient-index="${index}" value="${escapeAttribute(ingredient.name || "")}" />
      <input class="records-cell-input" type="text" placeholder="Amount" ${fieldPrefix}="amount" data-ingredient-index="${index}" value="${escapeAttribute(ingredient.amount || "")}" />
      <input class="records-cell-input" type="text" placeholder="Unit" ${fieldPrefix}="unit" data-ingredient-index="${index}" value="${escapeAttribute(ingredient.unit || "")}" />
      <input class="records-cell-input" type="text" placeholder="%DV" ${fieldPrefix}="dailyValuePercent" data-ingredient-index="${index}" value="${escapeAttribute(ingredient.dailyValuePercent || "")}" />
      <button class="records-ingredient-remove" type="button" ${edit ? `data-record-edit-remove-ingredient="${index}"` : `data-remove-supplement-ingredient="${index}"`}>Remove</button>
    </div>
  `).join("")
}

function updateSupplementScanUi() {
  const fileName = document.getElementById("records-supplement-file-name")
  const clearButton = document.getElementById("records-supplement-clear-file")
  const scanButton = document.getElementById("records-supplement-scan-button")

  if (fileName) {
    fileName.textContent = recordsState.supplementScanFile
      ? recordsState.supplementScanFile.name
      : "No label selected."
  }

  if (clearButton) {
    clearButton.hidden = !recordsState.supplementScanFile
  }

  if (scanButton) {
    scanButton.textContent = recordsState.supplementScanFile ? "Rescan Label" : "Scan Label"
  }
}

function populateSupplementForm(data = {}, options = {}) {
  const { mergeIngredients = false } = options
  const currentIngredients = getSupplementIngredientsFromForm()
  document.getElementById("records-supplement-name").value = String(data.medicationName || "").trim()
  document.getElementById("records-supplement-brand").value = String(data.brand || "").trim()
  document.getElementById("records-supplement-form-factor").value = String(data.form || "").trim()
  document.getElementById("records-supplement-serving-size").value = String(data.servingSize || "").trim()
  document.getElementById("records-supplement-dose").value = String(data.dose || "").trim()
  document.getElementById("records-supplement-frequency").value = String(data.frequency || "").trim()
  document.getElementById("records-supplement-time-of-day").value = String(data.timeOfDay || "").trim()
  document.getElementById("records-supplement-purpose").value = String(data.purpose || "").trim()
  document.getElementById("records-supplement-suggested-use").value = String(data.suggestedUse || "").trim()
  document.getElementById("records-supplement-active").checked = data.active !== false

  const nextIngredients = mergeIngredients
    ? [...currentIngredients, ...normalizeSupplementIngredients(data.ingredients)].filter((ingredient, index, array) => {
        const key = `${ingredient.name}|${ingredient.amount}|${ingredient.unit}|${ingredient.dailyValuePercent}`.toLowerCase()
        return array.findIndex((candidate) => `${candidate.name}|${candidate.amount}|${candidate.unit}|${candidate.dailyValuePercent}`.toLowerCase() === key) === index
      })
    : normalizeSupplementIngredients(data.ingredients)

  renderSupplementIngredientsEditor("records-supplement-ingredients", nextIngredients)
}

function getSupplementIngredientsFromForm() {
  const rows = Array.from(document.querySelectorAll("#records-supplement-ingredients .records-ingredient-row"))

  return rows.map((row) => ({
    name: row.querySelector('[data-supplement-ingredient-field="name"]')?.value.trim() || "",
    amount: row.querySelector('[data-supplement-ingredient-field="amount"]')?.value.trim() || "",
    unit: row.querySelector('[data-supplement-ingredient-field="unit"]')?.value.trim() || "",
    dailyValuePercent: row.querySelector('[data-supplement-ingredient-field="dailyValuePercent"]')?.value.trim() || ""
  })).filter((ingredient) => ingredient.name || ingredient.amount || ingredient.unit || ingredient.dailyValuePercent)
}

function renderRecordsReview() {
  const extraction = recordsState.pendingExtraction
  const body = document.getElementById("records-review-body")
  const title = document.getElementById("records-confirmation-title")
  const meta = document.getElementById("records-confirmation-meta")
  const summary = document.getElementById("records-review-summary")
  const labReview = document.getElementById("records-lab-review")
  const doctorReview = document.getElementById("records-doctor-review")
  const addValueButton = document.getElementById("records-add-value-button")

  if (!extraction || !body || !title || !meta || !summary || !labReview || !doctorReview) {
    return
  }

  const isDoctorVisit = isDoctorVisitRecordType(extraction.type)
  labReview.hidden = isDoctorVisit
  doctorReview.hidden = !isDoctorVisit
  addValueButton.hidden = isDoctorVisit

  if (isDoctorVisit) {
    const data = extraction.extractionResult
    const warnings = Array.isArray(data.warnings) ? data.warnings : []
    const warningsElement = document.getElementById("records-doctor-warnings")
    title.textContent = `Doctor Visit - ${formatDateLabel(extraction.date)}`
    meta.textContent = [data.provider, data.practice, extraction.fileName].filter(Boolean).join(" | ") || "Review the generated visit summary"
    warningsElement.hidden = !warnings.length
    warningsElement.innerHTML = warnings.length
      ? `<strong>Review before saving</strong>${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}`
      : ""
    document.getElementById("records-review-visit-date").value = extraction.date || data.visitDate || ""
    document.getElementById("records-review-provider").value = data.provider || ""
    document.getElementById("records-review-provider-credentials").value = data.providerCredentials || ""
    document.getElementById("records-review-practice").value = data.practice || ""
    document.getElementById("records-review-visit-type").value = data.visitType || ""
    document.getElementById("records-review-patient-name").value = data.patientNameAsWritten || ""
    document.getElementById("records-review-visit-summary").value = data.summaryMarkdown || ""
    summary.textContent = warnings.length
      ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"} to review`
      : "Ready to save after your review"
    return
  }

  title.textContent = `${getRecordTypeLabel(recordsState.activeType)} — ${extraction.source} — ${formatDateLabel(extraction.date)}`
  title.textContent = `${getRecordTypeLabel(recordsState.activeType)} - ${extraction.source} - Lab Work Date ${formatDateLabel(extraction.date)}`
  meta.textContent = extraction.extractionResult.panelName || extraction.extractionResult.labName || extraction.fileName || "Review extracted values"

  const values = Array.isArray(extraction.extractionResult.values) ? extraction.extractionResult.values : []
  body.innerHTML = values.map((value, index) => {
    const badge = getFlagBadge(value.flag)

    return `
      <tr>
        <td><input class="records-cell-input" type="text" data-review-field="name" data-review-index="${index}" value="${escapeAttribute(value.name || "")}" /></td>
        <td><input class="records-cell-input" type="number" step="any" data-review-field="value" data-review-index="${index}" value="${escapeAttribute(value.value ?? "")}" /></td>
        <td><input class="records-cell-input" type="text" data-review-field="rangeText" data-review-index="${index}" value="${escapeAttribute(value.rangeText || "")}" /></td>
        <td>
          <select class="records-cell-input" data-review-field="flag" data-review-index="${index}">
            ${["normal", "high", "low", "borderline", "critical"].map((option) => `
              <option value="${option}" ${option === value.flag ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
          <span class="records-flag-inline ${badge.className}">${badge.icon} ${badge.label}</span>
        </td>
      </tr>
    `
  }).join("")

  summary.textContent = `${extraction.extractionResult.normalCount} normal, ${extraction.extractionResult.flaggedCount} flagged, ${extraction.extractionResult.borderlineCount} borderline`
}

function recalculateReviewCounts() {
  const extraction = recordsState.pendingExtraction

  if (!extraction) {
    return
  }

  extraction.extractionResult.flaggedCount = extraction.extractionResult.values.filter((value) => ["high", "low", "critical"].includes(String(value.flag))).length
  extraction.extractionResult.borderlineCount = extraction.extractionResult.values.filter((value) => String(value.flag) === "borderline").length
  extraction.extractionResult.normalCount = extraction.extractionResult.values.filter((value) => String(value.flag) === "normal").length
  const summary = document.getElementById("records-review-summary")

  if (summary) {
    summary.textContent = `${extraction.extractionResult.normalCount} normal, ${extraction.extractionResult.flaggedCount} flagged, ${extraction.extractionResult.borderlineCount} borderline`
  }
}

function summarizeFlaggedValues(record) {
  if (isDoctorVisitRecordType(record?.type)) {
    const data = isObject(record?.extractedData) ? record.extractedData : {}
    const reason = String(data.summaryMarkdown || "").match(/^- Reason for visit:\s*(.+)$/im)?.[1]
    return reason || data.visitType || "Visit summary"
  }

  if (isMedicationRecordType(record?.type)) {
    const data = isObject(record?.extractedData) ? record.extractedData : {}
    const summaryBits = isSupplementRecordType(record?.type)
      ? [
          String(data.brand || "").trim(),
          String(data.purpose || "").trim(),
          Array.isArray(data.ingredients) && data.ingredients.length
            ? `${data.ingredients.length} ingredients`
            : ""
        ].filter(Boolean)
      : [
          String(data.purpose || "").trim(),
          String(data.frequency || "").trim(),
          String(data.timeOfDay || "").trim()
        ].filter(Boolean)

    return summaryBits.length ? summaryBits.join(" • ") : `${getMedicationTerm(record?.type)} entry`
  }

  const values = Array.isArray(record?.extractedData?.values) ? record.extractedData.values : []
  const flagged = values.filter((value) => String(value?.flag || "normal") !== "normal")

  if (!flagged.length && values.length) {
    return "All extracted values were normal."
  }

  if (!flagged.length) {
    return "No extracted values saved."
  }

  return flagged.slice(0, 4).map((value) => `${value.name} ${value.value}`).join(" • ")
}

function replaceVisitDateInSummary(summaryMarkdown, visitDate) {
  const summary = String(summaryMarkdown || "")
  const date = String(visitDate || "").trim()

  if (!date) {
    return summary
  }

  return /^- Visit date:.*$/im.test(summary)
    ? summary.replace(/^- Visit date:.*$/im, `- Visit date: ${date}`)
    : summary
}

function buildExtractionResultFromDraft(draft) {
  if (isDoctorVisitRecordType(draft?.type)) {
    return {
      ...draft.extractedData,
      provider: String(draft?.extractedData?.provider || "").trim() || null,
      providerCredentials: String(draft?.extractedData?.providerCredentials || "").trim() || null,
      practice: String(draft?.extractedData?.practice || "").trim() || null,
      visitType: String(draft?.extractedData?.visitType || "").trim() || null,
      patientNameAsWritten: String(draft?.extractedData?.patientNameAsWritten || "").trim() || null,
      summaryMarkdown: String(draft?.extractedData?.summaryMarkdown || "").trim(),
      warnings: Array.isArray(draft?.extractedData?.warnings) ? draft.extractedData.warnings : [],
      rawText: draft.rawText || null,
      flaggedCount: 0,
      borderlineCount: 0,
      normalCount: 0
    }
  }

  if (isMedicationRecordType(draft?.type)) {
    if (isSupplementRecordType(draft?.type)) {
      const ingredients = normalizeSupplementIngredients(draft?.extractedData?.ingredients || [])
        .filter((ingredient) => ingredient.name || ingredient.amount || ingredient.unit || ingredient.dailyValuePercent)

      return {
        medicationName: String(draft?.extractedData?.medicationName || "").trim(),
        brand: String(draft?.extractedData?.brand || "").trim(),
        form: String(draft?.extractedData?.form || "").trim(),
        servingSize: String(draft?.extractedData?.servingSize || "").trim(),
        suggestedUse: String(draft?.extractedData?.suggestedUse || "").trim(),
        dose: String(draft?.extractedData?.dose || "").trim(),
        frequency: String(draft?.extractedData?.frequency || "").trim(),
        timeOfDay: String(draft?.extractedData?.timeOfDay || "").trim(),
        purpose: String(draft?.extractedData?.purpose || "").trim(),
        active: Boolean(draft?.extractedData?.active),
        ingredients,
        rawText: draft.rawText || null,
        flaggedCount: 0,
        borderlineCount: 0,
        normalCount: 0
      }
    }

    return {
      medicationName: String(draft?.extractedData?.medicationName || "").trim(),
      dose: String(draft?.extractedData?.dose || "").trim(),
      frequency: String(draft?.extractedData?.frequency || "").trim(),
      timeOfDay: String(draft?.extractedData?.timeOfDay || "").trim(),
      purpose: String(draft?.extractedData?.purpose || "").trim(),
      active: Boolean(draft?.extractedData?.active),
      rawText: draft.rawText || null,
      flaggedCount: 0,
      borderlineCount: 0,
      normalCount: 0
    }
  }

  const values = Array.isArray(draft?.extractedData?.values)
    ? draft.extractedData.values
        .filter((value) => String(value?.name || "").trim())
        .map((value) => ({
          ...value,
          value: numberOrNull(value.value),
          unit: String(value.unit || "").trim() || null,
          rangeLow: numberOrNull(value.rangeLow),
          rangeHigh: numberOrNull(value.rangeHigh),
          rangeText: String(value.rangeText || "").trim() || null,
          interpretation: String(value.interpretation || "").trim() || null,
          flag: String(value.flag || "normal").trim().toLowerCase() || "normal"
        }))
    : []

  return {
    ...draft.extractedData,
    values,
    rawText: draft.rawText || null,
    flaggedCount: values.filter((entry) => ["high", "low", "critical"].includes(entry.flag)).length,
    borderlineCount: values.filter((entry) => entry.flag === "borderline").length,
    normalCount: values.filter((entry) => entry.flag === "normal").length
  }
}

function renderRecordDetail(record) {
  if (isDoctorVisitRecordType(record?.type)) {
    const isEditing = recordsState.editingRecordId === record.recordId
    const detailRecord = isEditing && recordsState.editDraft ? recordsState.editDraft : record
    const data = isObject(detailRecord?.extractedData) ? detailRecord.extractedData : {}
    const warnings = Array.isArray(data.warnings) ? data.warnings : []

    if (isEditing) {
      return `
        <div class="records-detail records-visit-detail">
          <div class="compact-fields">
            <label class="field">
              <span>Visit Date</span>
              <input type="date" data-record-edit-meta="date" value="${escapeAttribute(detailRecord.date || "")}" />
            </label>
            <label class="field">
              <span>Provider</span>
              <input type="text" data-record-edit-doctor="provider" value="${escapeAttribute(data.provider || "")}" />
            </label>
          </div>
          <div class="compact-fields">
            <label class="field">
              <span>Credentials</span>
              <input type="text" data-record-edit-doctor="providerCredentials" value="${escapeAttribute(data.providerCredentials || "")}" />
            </label>
            <label class="field">
              <span>Practice</span>
              <input type="text" data-record-edit-doctor="practice" value="${escapeAttribute(data.practice || "")}" />
            </label>
          </div>
          <div class="compact-fields">
            <label class="field">
              <span>Visit Type</span>
              <input type="text" data-record-edit-doctor="visitType" value="${escapeAttribute(data.visitType || "")}" />
            </label>
            <label class="field">
              <span>Patient Name in Document</span>
              <input type="text" data-record-edit-doctor="patientNameAsWritten" value="${escapeAttribute(data.patientNameAsWritten || "")}" />
            </label>
          </div>
          <label class="field">
            <span>Source</span>
            <input type="text" data-record-edit-meta="source" value="${escapeAttribute(detailRecord.source || "")}" />
          </label>
          <label class="field">
            <span>Visit Summary</span>
            <textarea class="records-summary-editor" rows="22" data-record-edit-doctor="summaryMarkdown">${escapeHtml(data.summaryMarkdown || "")}</textarea>
          </label>
          <label class="field">
            <span>Personal Notes</span>
            <textarea rows="3" data-record-edit-meta="notes">${escapeHtml(detailRecord.notes || "")}</textarea>
          </label>
          <div class="records-confirmation-actions">
            <button class="button-primary" type="button" data-record-edit-save="${escapeAttribute(record.recordId)}">Save Changes</button>
            <button class="button-secondary" type="button" data-record-edit-cancel="${escapeAttribute(record.recordId)}">Cancel</button>
          </div>
        </div>
      `
    }

    return `
      <div class="records-detail records-visit-detail">
        ${warnings.length ? `<div class="records-doctor-warnings"><strong>Review note</strong>${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : ""}
        <div class="records-visit-meta">
          <div><span>Provider</span><strong>${escapeHtml([data.provider, data.providerCredentials].filter(Boolean).join(", ") || "Not documented")}</strong></div>
          <div><span>Practice</span><strong>${escapeHtml(data.practice || "Not documented")}</strong></div>
          <div><span>Visit Type</span><strong>${escapeHtml(data.visitType || "Not documented")}</strong></div>
          <div><span>Source</span><strong>${escapeHtml(data.sourceFileName || detailRecord.source || "Not documented")}</strong></div>
        </div>
        <article class="records-visit-summary markdown-content">${renderRichMarkdown(data.summaryMarkdown || "No visit summary saved.")}</article>
        ${detailRecord.notes ? `<div class="records-prescription-note"><span class="records-prescription-label">Personal Notes</span><p>${escapeHtml(detailRecord.notes)}</p></div>` : ""}
        ${detailRecord.rawText ? `<details class="records-raw-source"><summary>View extracted source text</summary><pre>${escapeHtml(detailRecord.rawText)}</pre></details>` : ""}
      </div>
    `
  }

  if (isMedicationRecordType(record?.type)) {
    const isEditing = recordsState.editingRecordId === record.recordId
    const detailRecord = isEditing && recordsState.editDraft ? recordsState.editDraft : record
    const data = isObject(detailRecord?.extractedData) ? detailRecord.extractedData : {}
    const medicationTerm = getMedicationTerm(record?.type)

    if (isSupplementRecordType(record?.type)) {
      const ingredients = normalizeSupplementIngredients(data.ingredients || [])

      if (isEditing) {
        return `
          <div class="records-detail">
            <div class="compact-fields">
              <label class="field">
                <span>Date Added</span>
                <input type="date" data-record-edit-meta="date" value="${escapeAttribute(detailRecord.date || "")}" />
              </label>
              <label class="field">
                <span>Supplement Name</span>
                <input type="text" data-record-edit-rx="medicationName" value="${escapeAttribute(data.medicationName || "")}" />
              </label>
            </div>
            <div class="compact-fields">
              <label class="field">
                <span>Brand</span>
                <input type="text" data-record-edit-rx="brand" value="${escapeAttribute(data.brand || "")}" />
              </label>
              <label class="field">
                <span>Form</span>
                <input type="text" data-record-edit-rx="form" value="${escapeAttribute(data.form || "")}" />
              </label>
            </div>
            <div class="compact-fields">
              <label class="field">
                <span>Serving Size</span>
                <input type="text" data-record-edit-rx="servingSize" value="${escapeAttribute(data.servingSize || "")}" />
              </label>
              <label class="field">
                <span>Dose You Take</span>
                <input type="text" data-record-edit-rx="dose" value="${escapeAttribute(data.dose || "")}" />
              </label>
            </div>
            <div class="compact-fields">
              <label class="field">
                <span>Frequency</span>
                <input type="text" data-record-edit-rx="frequency" value="${escapeAttribute(data.frequency || "")}" />
              </label>
              <label class="field">
                <span>Time of Day</span>
                <input type="text" data-record-edit-rx="timeOfDay" value="${escapeAttribute(data.timeOfDay || "")}" />
              </label>
            </div>
            <label class="field">
              <span>Suggested Use</span>
              <input type="text" data-record-edit-rx="suggestedUse" value="${escapeAttribute(data.suggestedUse || "")}" />
            </label>
            <label class="field">
              <span>What It's For</span>
              <input type="text" data-record-edit-rx="purpose" value="${escapeAttribute(data.purpose || "")}" />
            </label>
            <label class="records-toggle-field records-toggle-field-inline" for="records-edit-active-${escapeAttribute(record.recordId)}">
              <div>
                <strong>Active</strong>
                <p class="card-subtitle">${data.active ? "Currently taking" : "Not currently taking"}</p>
              </div>
              <span class="records-switch">
                <input id="records-edit-active-${escapeAttribute(record.recordId)}" type="checkbox" data-record-edit-rx="active" ${data.active ? "checked" : ""} />
                <span class="records-switch-track"></span>
              </span>
            </label>
            <section class="records-ingredients-section">
              <div class="records-ingredients-header">
                <div>
                  <strong>What's In It</strong>
                  <p class="card-subtitle">Edit the ingredient list Boris uses for this supplement.</p>
                </div>
                <button class="button-secondary" type="button" data-record-edit-add-ingredient="${escapeAttribute(record.recordId)}">Add Ingredient</button>
              </div>
              <div id="records-edit-ingredients-${escapeAttribute(record.recordId)}" class="records-ingredients-list"></div>
            </section>
            <label class="field">
              <span>Notes</span>
              <textarea rows="3" data-record-edit-meta="notes">${escapeHtml(detailRecord.notes || "")}</textarea>
            </label>
            <div class="records-confirmation-actions">
              <button class="button-primary" type="button" data-record-edit-save="${escapeAttribute(record.recordId)}">Save Changes</button>
              <button class="button-secondary" type="button" data-record-edit-cancel="${escapeAttribute(record.recordId)}">Cancel</button>
            </div>
          </div>
        `
      }

      return `
        <div class="records-detail">
          <div class="records-prescription-grid">
            <div class="records-prescription-item">
              <span class="records-prescription-label">Brand</span>
              <strong>${escapeHtml(data.brand || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Form</span>
              <strong>${escapeHtml(data.form || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Serving Size</span>
              <strong>${escapeHtml(data.servingSize || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Dose You Take</span>
              <strong>${escapeHtml(data.dose || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Frequency</span>
              <strong>${escapeHtml(data.frequency || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Time of Day</span>
              <strong>${escapeHtml(data.timeOfDay || "--")}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Status</span>
              <strong>${data.active ? "Active" : "Inactive"}</strong>
            </div>
            <div class="records-prescription-item">
              <span class="records-prescription-label">Ingredients</span>
              <strong>${ingredients.filter((ingredient) => ingredient.name).length || 0}</strong>
            </div>
          </div>
          ${data.purpose ? `
            <div class="records-prescription-note">
              <span class="records-prescription-label">What It's For</span>
              <p>${escapeHtml(data.purpose)}</p>
            </div>
          ` : ""}
          ${data.suggestedUse ? `
            <div class="records-prescription-note">
              <span class="records-prescription-label">Suggested Use</span>
              <p>${escapeHtml(data.suggestedUse)}</p>
            </div>
          ` : ""}
          ${ingredients.filter((ingredient) => ingredient.name).length ? `
            <div class="records-prescription-note">
              <span class="records-prescription-label">What's In It</span>
              <div class="records-ingredients-readonly">
                ${ingredients.filter((ingredient) => ingredient.name).map((ingredient) => `
                  <div class="records-ingredient-pill">
                    <strong>${escapeHtml(ingredient.name)}</strong>
                    <span>${escapeHtml([ingredient.amount, ingredient.unit].filter(Boolean).join(" ") || "--")}${ingredient.dailyValuePercent ? ` • ${escapeHtml(ingredient.dailyValuePercent)}% DV` : ""}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}
          ${detailRecord.notes ? `
            <div class="records-prescription-note">
              <span class="records-prescription-label">Notes</span>
              <p>${escapeHtml(detailRecord.notes)}</p>
            </div>
          ` : ""}
        </div>
      `
    }

    if (isEditing) {
      return `
        <div class="records-detail">
          <div class="compact-fields">
            <label class="field">
              <span>Date Added</span>
              <input type="date" data-record-edit-meta="date" value="${escapeAttribute(detailRecord.date || "")}" />
            </label>
            <label class="field">
              <span>${escapeHtml(medicationTerm)} Name</span>
              <input type="text" data-record-edit-rx="medicationName" value="${escapeAttribute(data.medicationName || "")}" />
            </label>
          </div>
          <div class="compact-fields">
            <label class="field">
              <span>Dose</span>
              <input type="text" data-record-edit-rx="dose" value="${escapeAttribute(data.dose || "")}" />
            </label>
            <label class="field">
              <span>Frequency</span>
              <input type="text" data-record-edit-rx="frequency" value="${escapeAttribute(data.frequency || "")}" />
            </label>
          </div>
          <div class="compact-fields">
            <label class="field">
              <span>Time of Day</span>
              <input type="text" data-record-edit-rx="timeOfDay" value="${escapeAttribute(data.timeOfDay || "")}" />
            </label>
            <label class="records-toggle-field records-toggle-field-inline" for="records-edit-active-${escapeAttribute(record.recordId)}">
              <div>
                <strong>Active</strong>
                <p class="card-subtitle">${data.active ? "Currently taking" : "Not currently taking"}</p>
              </div>
              <span class="records-switch">
                <input id="records-edit-active-${escapeAttribute(record.recordId)}" type="checkbox" data-record-edit-rx="active" ${data.active ? "checked" : ""} />
                <span class="records-switch-track"></span>
              </span>
            </label>
          </div>
          <label class="field">
            <span>What It's For</span>
            <input type="text" data-record-edit-rx="purpose" value="${escapeAttribute(data.purpose || "")}" />
          </label>
          <label class="field">
            <span>Notes</span>
            <textarea rows="3" data-record-edit-meta="notes">${escapeHtml(detailRecord.notes || "")}</textarea>
          </label>
          <div class="records-confirmation-actions">
            <button class="button-primary" type="button" data-record-edit-save="${escapeAttribute(record.recordId)}">Save Changes</button>
            <button class="button-secondary" type="button" data-record-edit-cancel="${escapeAttribute(record.recordId)}">Cancel</button>
          </div>
        </div>
      `
    }

    return `
      <div class="records-detail">
        <div class="records-prescription-grid">
          <div class="records-prescription-item">
            <span class="records-prescription-label">Dose</span>
            <strong>${escapeHtml(data.dose || "--")}</strong>
          </div>
          <div class="records-prescription-item">
            <span class="records-prescription-label">Frequency</span>
            <strong>${escapeHtml(data.frequency || "--")}</strong>
          </div>
          <div class="records-prescription-item">
            <span class="records-prescription-label">Time of Day</span>
            <strong>${escapeHtml(data.timeOfDay || "--")}</strong>
          </div>
          <div class="records-prescription-item">
            <span class="records-prescription-label">Status</span>
            <strong>${data.active ? "Active" : "Inactive"}</strong>
          </div>
        </div>
        <div class="records-prescription-note">
          <span class="records-prescription-label">What It's For</span>
          <p>${escapeHtml(data.purpose || "--")}</p>
        </div>
        ${detailRecord.notes ? `
          <div class="records-prescription-note">
            <span class="records-prescription-label">Notes</span>
            <p>${escapeHtml(detailRecord.notes)}</p>
          </div>
        ` : ""}
      </div>
    `
  }

  const isEditing = recordsState.editingRecordId === record.recordId
  const detailRecord = isEditing && recordsState.editDraft ? recordsState.editDraft : record
  const values = Array.isArray(detailRecord?.extractedData?.values) ? detailRecord.extractedData.values : []

  if (isEditing) {
    return `
      <div class="records-detail">
        <div class="compact-fields">
          <label class="field">
            <span>Lab Work Date</span>
            <input type="date" data-record-edit-meta="date" value="${escapeAttribute(detailRecord.date || "")}" />
          </label>
          <label class="field">
            <span>Source</span>
            <input type="text" data-record-edit-meta="source" value="${escapeAttribute(detailRecord.source || "")}" />
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea rows="3" data-record-edit-meta="notes">${escapeHtml(detailRecord.notes || "")}</textarea>
        </label>
        <table class="records-review-table records-review-table-readonly">
          <thead>
            <tr>
              <th>Test</th>
              <th>Value</th>
              <th>Range Low</th>
              <th>Range High</th>
              <th>Range Text</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            ${values.map((value, index) => `
              <tr>
                <td><input class="records-cell-input" type="text" data-record-edit-field="name" data-record-edit-index="${index}" value="${escapeAttribute(value.name || "")}" /></td>
                <td>
                  <input class="records-cell-input" type="number" step="any" data-record-edit-field="value" data-record-edit-index="${index}" value="${escapeAttribute(value.value ?? "")}" />
                  <input class="records-cell-input" type="text" data-record-edit-field="unit" data-record-edit-index="${index}" value="${escapeAttribute(value.unit || "")}" placeholder="unit" />
                </td>
                <td><input class="records-cell-input" type="number" step="any" data-record-edit-field="rangeLow" data-record-edit-index="${index}" value="${escapeAttribute(value.rangeLow ?? "")}" /></td>
                <td><input class="records-cell-input" type="number" step="any" data-record-edit-field="rangeHigh" data-record-edit-index="${index}" value="${escapeAttribute(value.rangeHigh ?? "")}" /></td>
                <td><input class="records-cell-input" type="text" data-record-edit-field="rangeText" data-record-edit-index="${index}" value="${escapeAttribute(value.rangeText || "")}" /></td>
                <td>
                  <select class="records-cell-input" data-record-edit-field="flag" data-record-edit-index="${index}">
                    ${["normal", "high", "low", "borderline", "critical"].map((option) => `
                      <option value="${option}" ${option === value.flag ? "selected" : ""}>${option}</option>
                    `).join("")}
                  </select>
                </td>
              </tr>
              <tr>
                <td colspan="6">
                  <input class="records-cell-input" type="text" data-record-edit-field="interpretation" data-record-edit-index="${index}" value="${escapeAttribute(value.interpretation || "")}" placeholder="Interpretation" />
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="records-confirmation-actions">
          <button class="button-secondary" type="button" data-record-edit-add="${escapeAttribute(record.recordId)}">Add missing value</button>
          <button class="button-primary" type="button" data-record-edit-save="${escapeAttribute(record.recordId)}">Save Changes</button>
          <button class="button-secondary" type="button" data-record-edit-cancel="${escapeAttribute(record.recordId)}">Cancel</button>
        </div>
      </div>
    `
  }

  if (!values.length) {
    return `<div class="empty-state">No structured values were saved for this record.</div>`
  }

  return `
    <div class="records-detail">
      <table class="records-review-table records-review-table-readonly">
        <thead>
          <tr>
            <th>Test</th>
            <th>Value</th>
            <th>Range</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          ${values.map((value) => {
            const badge = getFlagBadge(value.flag)

            return `
              <tr>
                <td>${escapeHtml(value.name || "")}</td>
                <td>${escapeHtml(hasValue(value.value) ? value.value : "--")}${value.unit ? ` ${escapeHtml(value.unit)}` : ""}</td>
                <td>${escapeHtml(value.rangeText || "--")}</td>
                <td><span class="records-flag-inline ${badge.className}">${badge.icon} ${badge.label}</span></td>
              </tr>
            `
          }).join("")}
        </tbody>
      </table>
    </div>
  `
}

function renderRecordsTimeline() {
  const timeline = document.getElementById("records-timeline")

  if (!timeline) {
    return
  }

  const notice = recordsState.notice
    ? `<p class="status-text records-timeline-notice">${escapeHtml(recordsState.notice)}</p>`
    : ""

  if (!recordsState.items.length) {
    timeline.innerHTML = `${notice}<div class="empty-state">${
      isMedicationRecordType(recordsState.activeType)
        ? `No ${getRecordTypeLabel(recordsState.activeType).toLowerCase()} yet. Add your first item using the ${getMedicationTerm(recordsState.activeType)} button above.`
        : "No records yet. Upload your first document using the Upload button above."
    }</div>`
    return
  }

  timeline.innerHTML = notice + recordsState.items.map((record) => {
    const expanded = recordsState.expandedRecordId === record.recordId
    const isMedication = isMedicationRecordType(record.type)
    const isDoctorVisit = isDoctorVisitRecordType(record.type)
    const data = isObject(record?.extractedData) ? record.extractedData : {}
    const medicationTerm = getMedicationTerm(record.type)
    let pills = ""

    if (isMedication) {
      pills = `${data.active ? '<span class="records-pill is-normal">Active</span>' : '<span class="records-pill is-borderline">Inactive</span>'}${data.timeOfDay ? ` <span class="records-pill">${escapeHtml(data.timeOfDay)}</span>` : ""}`
    } else if (isDoctorVisit) {
      const warningCount = Array.isArray(data.warnings) ? data.warnings.length : 0
      pills = `${data.visitType ? `<span class="records-pill">${escapeHtml(data.visitType)}</span>` : ""}${warningCount ? `<span class="records-pill is-borderline">Review ${warningCount} warning${warningCount === 1 ? "" : "s"}</span>` : '<span class="records-pill is-normal">Summary reviewed</span>'}`
    } else {
      const values = Array.isArray(record?.extractedData?.values) ? record.extractedData.values : []
      const highlightedValues = values
        .filter((value) => String(value?.flag || "normal") !== "normal")
        .slice(0, 4)

      pills = highlightedValues.length
        ? highlightedValues.map((value) => {
            const badge = getFlagBadge(value.flag)
            return `<span class="records-pill ${badge.className}">${badge.icon} ${escapeHtml(value.name)} ${escapeHtml(hasValue(value.value) ? value.value : "--")}</span>`
          }).join("")
        : '<span class="records-pill is-normal">All normal</span>'
    }

    return `
      <article class="records-card ${expanded ? "is-expanded" : ""}">
        <button class="records-card-button" type="button" data-record-expand="${escapeAttribute(record.recordId)}">
          <div class="records-card-topline">
            <strong>${escapeHtml(isMedication ? (data.medicationName || medicationTerm) : formatDateLabel(record.date))}</strong>
            <span class="records-card-type">${escapeHtml(getRecordTypeLabel(record.type))}</span>
          </div>
          <div class="records-card-source">${escapeHtml(
            isMedication
              ? (
                  isSupplementRecordType(record.type)
                    ? (data.brand || data.dose || medicationTerm)
                    : (data.dose || medicationTerm)
                )
              : isDoctorVisit
                ? ([data.provider, data.practice].filter(Boolean).join(" | ") || record.source || "Unknown provider")
                : (record.source || "Unknown source")
          )}</div>
          <p class="records-card-summary">${escapeHtml(summarizeFlaggedValues(record))}</p>
          <div class="records-card-pills">
            ${pills}
          </div>
        </button>
        <div class="records-card-actions">
          <button
            class="records-card-menu-trigger"
            type="button"
            data-record-menu-toggle="${escapeAttribute(record.recordId)}"
            aria-label="Record actions"
            aria-expanded="${recordsState.openMenuRecordId === record.recordId ? "true" : "false"}"
          >...</button>
          ${recordsState.openMenuRecordId === record.recordId ? `
            <div class="records-card-menu">
              <button class="records-card-menu-item" type="button" data-record-edit="${escapeAttribute(record.recordId)}">Edit</button>
              <button class="records-card-menu-item is-danger" type="button" data-record-delete="${escapeAttribute(record.recordId)}">Delete</button>
            </div>
          ` : ""}
        </div>
        ${expanded ? renderRecordDetail(record) : ""}
      </article>
    `
  }).join("")

  if (
    recordsState.editingRecordId &&
    recordsState.editDraft &&
    isSupplementRecordType(recordsState.editDraft.type)
  ) {
    renderSupplementIngredientsEditor(
      `records-edit-ingredients-${recordsState.editingRecordId}`,
      recordsState.editDraft?.extractedData?.ingredients || [],
      { edit: true }
    )
  }
}

async function loadRecordsTimeline() {
  const timeline = document.getElementById("records-timeline")

  if (timeline) {
    timeline.innerHTML = '<div class="empty-state">Loading records...</div>'
  }

  try {
    recordsState.items = await fetchJson(`/records/${recordsState.activeType}`)
    if (isMedicationRecordType(recordsState.activeType)) {
      recordsState.items.sort((left, right) => {
        const leftActive = Boolean(left?.extractedData?.active)
        const rightActive = Boolean(right?.extractedData?.active)

        if (rightActive !== leftActive) {
          return Number(rightActive) - Number(leftActive)
        }

        if (String(right?.date || "") !== String(left?.date || "")) {
          return String(right?.date || "").localeCompare(String(left?.date || ""))
        }

        return String(right?.recordId || "").localeCompare(String(left?.recordId || ""))
      })
    }
    renderRecordsTimeline()
  } catch (error) {
    timeline.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`
  }
}

function handleSelectedFile(file) {
  recordsState.selectedFile = file || null
  updateRecordsSelectedFileUi()
}

async function submitRecordsExtract(event) {
  event.preventDefault()
  const status = document.getElementById("records-upload-status")
  const button = document.getElementById("records-extract-button")
  const date = document.getElementById("records-date").value
  const source = document.getElementById("records-source").value.trim()
  const notes = document.getElementById("records-notes").value.trim()
  const doctorText = document.getElementById("records-doctor-text").value.trim()
  const isDoctorVisit = isDoctorVisitRecordType(recordsState.activeType)

  if (!recordsState.selectedFile && !(isDoctorVisit && doctorText)) {
    status.textContent = isDoctorVisit
      ? "Upload a file or paste the visit text first."
      : "Choose a file first."
    return
  }

  const formData = new FormData()
  if (recordsState.selectedFile) {
    formData.append("file", recordsState.selectedFile)
  }
  formData.append("type", recordsState.activeType)
  formData.append("date", date)
  formData.append("source", source)
  if (isDoctorVisit && doctorText) {
    formData.append("text", doctorText)
  }

  status.textContent = isDoctorVisit
    ? "Boris is creating a visit summary..."
    : "Boris is reading your document..."
  button.disabled = true

  try {
    const response = await fetch("/records/extract", {
      method: "POST",
      body: formData
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload.error || "Extraction failed.")
    }

    recordsState.pendingExtraction = {
      ...payload,
      notes
    }
    document.getElementById("records-upload-view").hidden = true
    document.getElementById("records-confirmation-view").hidden = false
    status.textContent = ""
    renderRecordsReview()
  } catch (error) {
    status.textContent = error.message
  } finally {
    button.disabled = false
  }
}

async function saveRecordsExtraction() {
  const extraction = recordsState.pendingExtraction
  const status = document.getElementById("records-save-status")

  if (!extraction) {
    return
  }

  status.textContent = isDoctorVisitRecordType(extraction.type)
    ? "Saving visit and refreshing Health Picture..."
    : "Saving record..."

  try {
    const response = await fetchJson("/records/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: extraction.type,
        date: extraction.date,
        source: extraction.source,
        notes: extraction.notes || "",
        extractionResult: extraction.extractionResult
      })
    })

    recordsState.notice = response.message || "Record saved."
    resetRecordsUploadState()
    closeRecordsUploadModal()
    await loadRecordsTimeline()
  } catch (error) {
    status.textContent = error.message
  }
}

async function scanSupplementLabel() {
  const status = document.getElementById("records-supplement-scan-status")
  const fileInput = document.getElementById("records-supplement-file-input")
  const file = fileInput?.files?.[0] || recordsState.supplementScanFile

  if (!file) {
    status.textContent = "Choose a label image first."
    return
  }

  recordsState.supplementScanFile = file
  updateSupplementScanUi()
  status.textContent = "Boris is reading your supplement label..."

  const formData = new FormData()
  formData.append("file", file)
  formData.append("type", "supplement")
  formData.append("date", getTodayDateString())
  formData.append("source", "Supplement Label")

  try {
    const response = await fetch("/records/extract", {
      method: "POST",
      body: formData
    })
    const payload = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(payload.error || "Supplement label scan failed.")
    }

    populateSupplementForm(payload.extractionResult || {})
    status.textContent = "Label scanned. Review the fields before saving."
  } catch (error) {
    status.textContent = error.message
  }
}

async function savePrescriptionRecord(event) {
  event.preventDefault()
  const status = document.getElementById("records-prescription-status")
  const saveButton = document.getElementById("records-prescription-save")
  const medicationTerm = getMedicationTerm(recordsState.activeType)
  const medicationName = document.getElementById("records-prescription-name").value.trim()
  const dose = document.getElementById("records-prescription-dose").value.trim()
  const frequency = document.getElementById("records-prescription-frequency").value.trim()
  const timeOfDay = document.getElementById("records-prescription-time-of-day").value.trim()
  const purpose = document.getElementById("records-prescription-purpose").value.trim()
  const notes = document.getElementById("records-prescription-notes").value.trim()
  const active = document.getElementById("records-prescription-active").checked

  if (!medicationName || !dose || !frequency || !timeOfDay || !purpose) {
    status.textContent = `Fill out the ${medicationTerm.toLowerCase()} name, dose, frequency, time of day, and purpose.`
    return
  }

  saveButton.disabled = true
  status.textContent = `Saving ${medicationTerm.toLowerCase()}...`

  try {
    await fetchJson("/records/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: recordsState.activeType,
        date: getTodayDateString(),
        source: `${medicationTerm} Manager`,
        notes,
        extractionResult: {
          medicationName,
          dose,
          frequency,
          timeOfDay,
          purpose,
          active,
          flaggedCount: 0,
          borderlineCount: 0,
          normalCount: 0
        }
      })
    })

    status.textContent = `${medicationTerm} saved.`
    resetRecordsUploadState()
    closeRecordsUploadModal()
    await loadRecordsTimeline()
  } catch (error) {
    status.textContent = error.message
  } finally {
    saveButton.disabled = false
  }
}

async function saveSupplementRecord(event) {
  event.preventDefault()
  const status = document.getElementById("records-supplement-status")
  const saveButton = document.getElementById("records-supplement-save")
  const supplementName = document.getElementById("records-supplement-name").value.trim()
  const brand = document.getElementById("records-supplement-brand").value.trim()
  const form = document.getElementById("records-supplement-form-factor").value.trim()
  const servingSize = document.getElementById("records-supplement-serving-size").value.trim()
  const dose = document.getElementById("records-supplement-dose").value.trim()
  const frequency = document.getElementById("records-supplement-frequency").value.trim()
  const timeOfDay = document.getElementById("records-supplement-time-of-day").value.trim()
  const purpose = document.getElementById("records-supplement-purpose").value.trim()
  const suggestedUse = document.getElementById("records-supplement-suggested-use").value.trim()
  const notes = document.getElementById("records-supplement-notes").value.trim()
  const active = document.getElementById("records-supplement-active").checked
  const ingredients = getSupplementIngredientsFromForm()

  if (!supplementName || !dose || !frequency) {
    status.textContent = "Fill out the supplement name, dose you take, and frequency."
    return
  }

  saveButton.disabled = true
  status.textContent = "Saving supplement..."

  try {
    await fetchJson("/records/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "supplement",
        date: getTodayDateString(),
        source: brand || "Supplement Manager",
        notes,
        extractionResult: {
          medicationName: supplementName,
          brand,
          form,
          servingSize,
          suggestedUse,
          dose,
          frequency,
          timeOfDay,
          purpose,
          active,
          ingredients,
          flaggedCount: 0,
          borderlineCount: 0,
          normalCount: 0
        }
      })
    })

    status.textContent = "Supplement saved."
    resetRecordsUploadState()
    closeRecordsUploadModal()
    await loadRecordsTimeline()
  } catch (error) {
    status.textContent = error.message
  } finally {
    saveButton.disabled = false
  }
}

async function saveEditedRecord(recordId) {
  if (!recordsState.editDraft) {
    return
  }

  const extractionResult = buildExtractionResultFromDraft(recordsState.editDraft)
  const nextSource = isSupplementRecordType(recordsState.editDraft.type)
    ? extractionResult.brand || recordsState.editDraft.source || "Supplement Manager"
    : recordsState.editDraft.source

  const response = await fetchJson(`/records/${encodeURIComponent(recordId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      date: recordsState.editDraft.date,
      source: nextSource,
      notes: recordsState.editDraft.notes,
      extractionResult
    })
  })

  recordsState.notice = response.message || "Record updated."
  recordsState.editingRecordId = null
  recordsState.editDraft = null
  await loadRecordsTimeline()
  recordsState.expandedRecordId = recordId
  renderRecordsTimeline()
}

async function setupRecordsPage() {
  await setupShellPage()
  setRecordsTab(recordsState.activeType)
  document.getElementById("records-date").value = getTodayDateString()
  resetRecordsUploadState()
  closeRecordsUploadModal()
  await loadRecordsTimeline()

  document.querySelectorAll("[data-records-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      recordsState.expandedRecordId = null
      setRecordsTab(button.dataset.recordsTab)
      resetRecordsUploadState()
      closeRecordsUploadModal()
      await loadRecordsTimeline()
    })
  })

  const fileInput = document.getElementById("records-file-input")
  const dropzone = document.getElementById("records-dropzone")
  const openUploadButton = document.getElementById("records-open-upload")
  const closeUploadButton = document.getElementById("records-modal-close")
  const uploadBackdrop = document.getElementById("records-upload-backdrop")
  const clearFileButton = document.getElementById("records-clear-file")
  const supplementFileInput = document.getElementById("records-supplement-file-input")
  const supplementScanButton = document.getElementById("records-supplement-scan-button")
  const supplementClearFileButton = document.getElementById("records-supplement-clear-file")

  if (closeUploadButton) {
    closeUploadButton.textContent = "x"
  }

  if (clearFileButton) {
    clearFileButton.textContent = "x"
  }

  openUploadButton?.addEventListener("click", () => {
    resetRecordsUploadState()
    openRecordsUploadModal()
  })

  closeUploadButton?.addEventListener("click", () => {
    resetRecordsUploadState()
    closeRecordsUploadModal()
  })

  uploadBackdrop?.addEventListener("click", () => {
    resetRecordsUploadState()
    closeRecordsUploadModal()
  })

  clearFileButton?.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    handleSelectedFile(null)

    if (fileInput) {
      fileInput.value = ""
    }
  })

  fileInput?.addEventListener("change", () => {
    handleSelectedFile(fileInput.files?.[0] || null)
  })

  supplementScanButton?.addEventListener("click", () => {
    supplementFileInput?.click()
  })

  supplementFileInput?.addEventListener("change", () => {
    recordsState.supplementScanFile = supplementFileInput.files?.[0] || null
    updateSupplementScanUi()

    if (recordsState.supplementScanFile) {
      scanSupplementLabel().catch((error) => {
        document.getElementById("records-supplement-scan-status").textContent = error.message
      })
    }
  })

  supplementClearFileButton?.addEventListener("click", () => {
    recordsState.supplementScanFile = null
    if (supplementFileInput) {
      supplementFileInput.value = ""
    }
    updateSupplementScanUi()
    document.getElementById("records-supplement-scan-status").textContent = ""
  })

  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault()
    dropzone.classList.add("is-dragover")
  })

  dropzone?.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-dragover")
  })

  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault()
    dropzone.classList.remove("is-dragover")
    handleSelectedFile(event.dataTransfer?.files?.[0] || null)
  })

  document.getElementById("records-upload-form")?.addEventListener("submit", submitRecordsExtract)
  document.getElementById("records-prescription-form")?.addEventListener("submit", savePrescriptionRecord)
  document.getElementById("records-supplement-form")?.addEventListener("submit", saveSupplementRecord)
  document.getElementById("records-cancel-button")?.addEventListener("click", () => {
    resetRecordsUploadState()
    closeRecordsUploadModal()
  })
  document.getElementById("records-supplement-add-ingredient")?.addEventListener("click", () => {
    const nextIngredients = [...getSupplementIngredientsFromForm(), createEmptySupplementIngredient()]
    renderSupplementIngredientsEditor("records-supplement-ingredients", nextIngredients)
  })
  document.getElementById("records-save-button")?.addEventListener("click", saveRecordsExtraction)
  document.getElementById("records-add-value-button")?.addEventListener("click", () => {
    if (!recordsState.pendingExtraction) {
      return
    }

    recordsState.pendingExtraction.extractionResult.values.push({
      name: "",
      value: null,
      unit: null,
      rangeLow: null,
      rangeHigh: null,
      rangeText: "",
      flag: "normal",
      interpretation: null
    })
    renderRecordsReview()
  })

  document.getElementById("records-review-body")?.addEventListener("input", (event) => {
    const index = Number(event.target?.dataset?.reviewIndex)
    const field = event.target?.dataset?.reviewField
    const values = recordsState.pendingExtraction?.extractionResult?.values

    if (!values?.[index] || !field) {
      return
    }

    values[index][field] = field === "value"
      ? numberOrNull(event.target.value)
      : event.target.value
    recalculateReviewCounts()

    if (field === "flag") {
      renderRecordsReview()
    }
  })

  const doctorReviewFields = {
    "records-review-provider": "provider",
    "records-review-provider-credentials": "providerCredentials",
    "records-review-practice": "practice",
    "records-review-visit-type": "visitType",
    "records-review-patient-name": "patientNameAsWritten",
    "records-review-visit-summary": "summaryMarkdown"
  }

  Object.entries(doctorReviewFields).forEach(([elementId, field]) => {
    document.getElementById(elementId)?.addEventListener("input", (event) => {
      if (recordsState.pendingExtraction?.extractionResult) {
        recordsState.pendingExtraction.extractionResult[field] = event.target.value
      }
    })
  })

  document.getElementById("records-review-visit-date")?.addEventListener("input", (event) => {
    const extraction = recordsState.pendingExtraction

    if (!extraction?.extractionResult) {
      return
    }

    extraction.date = event.target.value
    extraction.extractionResult.visitDate = event.target.value
    extraction.extractionResult.summaryMarkdown = replaceVisitDateInSummary(
      extraction.extractionResult.summaryMarkdown,
      event.target.value
    )
    document.getElementById("records-review-visit-summary").value = extraction.extractionResult.summaryMarkdown
    document.getElementById("records-confirmation-title").textContent = `Doctor Visit - ${formatDateLabel(event.target.value)}`
  })

  document.getElementById("records-supplement-ingredients")?.addEventListener("input", () => {
    recordsState.pendingExtraction = null
  })

  document.getElementById("records-supplement-ingredients")?.addEventListener("click", (event) => {
    const removeIndex = Number(event.target?.dataset?.removeSupplementIngredient)

    if (!Number.isFinite(removeIndex)) {
      return
    }

    const nextIngredients = getSupplementIngredientsFromForm().filter((_ingredient, index) => index !== removeIndex)
    renderSupplementIngredientsEditor(
      "records-supplement-ingredients",
      nextIngredients.length ? nextIngredients : [createEmptySupplementIngredient()]
    )
  })

  document.getElementById("records-timeline")?.addEventListener("click", async (event) => {
    const menuToggleId = event.target?.dataset?.recordMenuToggle
    const deleteId = event.target?.dataset?.recordDelete
    const editId = event.target?.dataset?.recordEdit
    const editSaveId = event.target?.dataset?.recordEditSave
    const editCancelId = event.target?.dataset?.recordEditCancel
    const editAddId = event.target?.dataset?.recordEditAdd
    const editAddIngredientId = event.target?.dataset?.recordEditAddIngredient
    const editRemoveIngredientIndex = Number(event.target?.dataset?.recordEditRemoveIngredient)
    const expandId = event.target?.closest("[data-record-expand]")?.dataset?.recordExpand

    if (menuToggleId) {
      event.stopPropagation()
      recordsState.openMenuRecordId = recordsState.openMenuRecordId === menuToggleId
        ? null
        : menuToggleId
      renderRecordsTimeline()
      return
    }

    if (editId) {
      event.stopPropagation()
      const record = recordsState.items.find((item) => item.recordId === editId)

      if (!record) {
        return
      }

      recordsState.expandedRecordId = editId
      recordsState.editingRecordId = editId
      recordsState.editDraft = cloneRecordForEdit(record)
      recordsState.openMenuRecordId = null
      renderRecordsTimeline()
      return
    }

    if (editCancelId) {
      event.stopPropagation()
      recordsState.editingRecordId = null
      recordsState.editDraft = null
      renderRecordsTimeline()
      return
    }

    if (editAddId) {
      event.stopPropagation()

      if (!recordsState.editDraft?.extractedData?.values) {
        return
      }

      recordsState.editDraft.extractedData.values.push({
        name: "",
        value: null,
        unit: null,
        rangeLow: null,
        rangeHigh: null,
        rangeText: "",
        flag: "normal",
        interpretation: null
      })
      renderRecordsTimeline()
      return
    }

    if (editAddIngredientId) {
      event.stopPropagation()

      if (!recordsState.editDraft?.extractedData) {
        return
      }

      recordsState.editDraft.extractedData.ingredients = [
        ...normalizeSupplementIngredients(recordsState.editDraft.extractedData.ingredients || []).filter((ingredient) => ingredient.name || ingredient.amount || ingredient.unit || ingredient.dailyValuePercent),
        createEmptySupplementIngredient()
      ]
      renderRecordsTimeline()
      return
    }

    if (Number.isFinite(editRemoveIngredientIndex) && event.target?.dataset?.recordEditRemoveIngredient !== undefined) {
      event.stopPropagation()

      if (!recordsState.editDraft?.extractedData?.ingredients) {
        return
      }

      const nextIngredients = normalizeSupplementIngredients(recordsState.editDraft.extractedData.ingredients)
        .filter((_ingredient, index) => index !== editRemoveIngredientIndex)
      recordsState.editDraft.extractedData.ingredients = nextIngredients.length
        ? nextIngredients
        : [createEmptySupplementIngredient()]
      renderRecordsTimeline()
      return
    }

    if (editSaveId) {
      event.stopPropagation()

      try {
        await saveEditedRecord(editSaveId)
      } catch (error) {
        showToast(error.message, "error")
      }

      return
    }

    if (deleteId) {
      event.stopPropagation()

      if (!window.confirm("Delete this record?")) {
        return
      }

      try {
        const response = await fetchJson(`/records/${encodeURIComponent(deleteId)}`, {
          method: "DELETE"
        })

        recordsState.notice = response.message || "Record deleted."
        recordsState.openMenuRecordId = null
        if (recordsState.expandedRecordId === deleteId) {
          recordsState.expandedRecordId = null
        }

        await loadRecordsTimeline()
      } catch (error) {
        showToast(error.message, "error")
      }

      return
    }

    if (!expandId) {
      return
    }

    recordsState.expandedRecordId = recordsState.expandedRecordId === expandId
      ? null
      : expandId
    recordsState.openMenuRecordId = null
    renderRecordsTimeline()
  })

  document.getElementById("records-timeline")?.addEventListener("input", (event) => {
    const metaField = event.target?.dataset?.recordEditMeta
    const rxField = event.target?.dataset?.recordEditRx
    const doctorField = event.target?.dataset?.recordEditDoctor
    const field = event.target?.dataset?.recordEditField
    const ingredientField = event.target?.dataset?.recordEditIngredientField
    const ingredientIndex = Number(event.target?.dataset?.ingredientIndex)
    const index = Number(event.target?.dataset?.recordEditIndex)

    if (metaField && recordsState.editDraft) {
      recordsState.editDraft[metaField] = event.target.value
      if (
        metaField === "date" &&
        isDoctorVisitRecordType(recordsState.editDraft.type) &&
        recordsState.editDraft.extractedData
      ) {
        recordsState.editDraft.extractedData.visitDate = event.target.value
        recordsState.editDraft.extractedData.summaryMarkdown = replaceVisitDateInSummary(
          recordsState.editDraft.extractedData.summaryMarkdown,
          event.target.value
        )
      }
      return
    }

    if (rxField && recordsState.editDraft?.extractedData) {
      recordsState.editDraft.extractedData[rxField] = event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value
      return
    }

    if (doctorField && recordsState.editDraft?.extractedData) {
      recordsState.editDraft.extractedData[doctorField] = event.target.value
      return
    }

    if (ingredientField && recordsState.editDraft?.extractedData) {
      const ingredients = normalizeSupplementIngredients(recordsState.editDraft.extractedData.ingredients || [])

      if (!ingredients[ingredientIndex]) {
        return
      }

      ingredients[ingredientIndex][ingredientField] = event.target.value
      recordsState.editDraft.extractedData.ingredients = ingredients
      return
    }

    const values = recordsState.editDraft?.extractedData?.values

    if (!values?.[index] || !field) {
      return
    }

    values[index][field] = ["value", "rangeLow", "rangeHigh"].includes(field)
      ? numberOrNull(event.target.value)
      : event.target.value
  })

  document.getElementById("records-timeline")?.addEventListener("change", (event) => {
    const rxField = event.target?.dataset?.recordEditRx

    if (!rxField || !recordsState.editDraft?.extractedData) {
      return
    }

    recordsState.editDraft.extractedData[rxField] = event.target.type === "checkbox"
      ? event.target.checked
      : event.target.value
  })

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return
    }

    if (!document.getElementById("records-upload-modal")?.hidden) {
      resetRecordsUploadState()
      closeRecordsUploadModal()
      return
    }

    if (recordsState.openMenuRecordId) {
      closeRecordsCardMenu()
      return
    }
  })

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".records-card-actions")) {
      closeRecordsCardMenu()
    }
  })
}

function getSchedulesTabMeta(tab) {
  return {
    recurring: "schedules-panel-recurring",
    calendar: "schedules-panel-calendar"
  }[tab] || "schedules-panel-recurring"
}

function setSchedulesTab(tab) {
  schedulesState.activeTab = ["recurring", "calendar"].includes(tab) ? tab : "recurring"

  document.querySelectorAll("[data-schedules-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.schedulesTab === schedulesState.activeTab)
  })

  document.querySelectorAll(".schedules-panel").forEach((panel) => {
    panel.hidden = panel.id !== getSchedulesTabMeta(schedulesState.activeTab)
  })

  const recurringToolbarActions = document.getElementById("recurring-toolbar-actions")

  if (recurringToolbarActions) {
    recurringToolbarActions.hidden = schedulesState.activeTab !== "recurring"
  }
}

function getMinutesFromTimeString(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function getRecurringCategoryClass(category) {
  return `is-${String(category || "personal").toLowerCase()}`
}

function formatShortDateLabel(value) {
  if (!value) {
    return "--"
  }

  const date = new Date(`${value}T12:00:00`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString([], {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric"
  })
}

function formatDayNameFromDate(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return date.toLocaleDateString([], {
    timeZone: APP_TIMEZONE,
    weekday: "short"
  })
}

function getCalendarSourceLabel(item) {
  return item?.sourceType === "recurring"
    ? "Recurring blocks"
    : String(item?.calendarName || "Google Calendar").trim()
}

function getCalendarSourceColor(calendarName) {
  const name = String(calendarName || "Google Calendar").trim().toLowerCase()
  let hash = 0

  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0
  }

  return CALENDAR_COLOR_PALETTE[Math.abs(hash) % CALENDAR_COLOR_PALETTE.length]
}

function getCalendarAccentStyle(item) {
  if (item?.sourceType === "recurring") {
    return "--calendar-accent:var(--category-accent)"
  }

  return `--calendar-accent:${getCalendarSourceColor(item?.calendarName)}`
}

function formatTimeRange(startTime, endTime, allDay = false) {
  if (allDay) {
    return "All day"
  }

  const formatValue = (value) => {
    if (!value) {
      return ""
    }

    const date = value.includes("T")
      ? new Date(value)
      : new Date(`2000-01-01T${String(value).slice(0, 5)}:00`)

    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 5)
    }

    return date.toLocaleTimeString([], {
      timeZone: value.includes("T") ? APP_TIMEZONE : undefined,
      hour: "numeric",
      minute: "2-digit"
    })
  }

  const startLabel = formatValue(startTime)
  const endLabel = formatValue(endTime)

  if (startLabel && endLabel) {
    return `${startLabel} - ${endLabel}`
  }

  return startLabel || endLabel || "Time flexible"
}

function escapeLineBreaks(value) {
  return escapeHtml(value || "").replace(/\n/g, "<br />")
}

function renderRecurringWeekGrid() {
  const grid = document.getElementById("recurring-week-grid")

  if (!grid) {
    return
  }

  const activeTimedItems = schedulesState.recurring.filter((item) => item.active && item.startTime && item.endTime)
  const invalidTimedItems = activeTimedItems.filter((item) => {
    const startMinutes = getMinutesFromTimeString(item.startTime)
    const endMinutes = getMinutesFromTimeString(item.endTime)
    return startMinutes === null || endMinutes === null || endMinutes <= startMinutes
  })
  const timedItems = activeTimedItems.filter((item) => !invalidTimedItems.includes(item))
  const flexibleItems = schedulesState.recurring.filter((item) => item.active && (!item.startTime || !item.endTime))
  const hours = Array.from({ length: 15 }, (_value, index) => 7 + index)

  const columns = SCHEDULE_DAY_ORDER.map((day) => {
    const blocks = timedItems.flatMap((item) => {
      if (!Array.isArray(item.daysOfWeek) || !item.daysOfWeek.includes(day)) {
        return []
      }

      const startMinutes = getMinutesFromTimeString(item.startTime)
      const endMinutes = getMinutesFromTimeString(item.endTime)

      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        return []
      }

      const topPercent = ((startMinutes - 420) / 900) * 100
      const heightPercent = ((endMinutes - startMinutes) / 900) * 100

      return [`
        <button
          class="recurring-grid-block ${getRecurringCategoryClass(item.category)}"
          type="button"
          style="top:${Math.max(0, topPercent)}%;height:${Math.max(heightPercent, 6)}%;"
          data-recurring-edit="${escapeAttribute(item.id)}"
        >
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(formatTimeRange(item.startTime, item.endTime))}</span>
        </button>
      `]
    })

    return `
      <section class="recurring-day-column">
        <header>
          <strong>${SCHEDULE_DAY_LABELS[day]}</strong>
        </header>
        <div class="recurring-day-track">
          ${hours.map((hour) => `<span class="recurring-day-line" style="top:${((hour * 60 - 420) / 900) * 100}%"></span>`).join("")}
          ${blocks.join("")}
        </div>
      </section>
    `
  }).join("")

  grid.innerHTML = `
    <div class="recurring-grid-shell">
      <div class="recurring-time-rail">
        ${hours.map((hour) => `<span>${new Date(2000, 0, 1, hour, 0, 0, 0).toLocaleTimeString([], { hour: "numeric" })}</span>`).join("")}
      </div>
      <div class="recurring-grid-days">
        ${columns}
      </div>
    </div>
    <div class="recurring-grid-footer">
      ${invalidTimedItems.length ? `
        <div class="recurring-grid-warning">
          <strong>${invalidTimedItems.length === 1 ? "One block needs attention" : `${invalidTimedItems.length} blocks need attention`}</strong>
          <span>The end time must be later than the start time.</span>
          ${invalidTimedItems.map((item) => `<button class="mini-button" type="button" data-recurring-edit="${escapeAttribute(item.id)}">Fix ${escapeHtml(item.title)}</button>`).join("")}
        </div>
      ` : ""}
      ${flexibleItems.length ? `
        <div class="recurring-flex-list">
          <strong>Flexible blocks</strong>
          <div class="recurring-flex-chips">
            ${flexibleItems.map((item) => `
              <button
                class="recurring-flex-chip ${getRecurringCategoryClass(item.category)}"
                type="button"
                data-recurring-edit="${escapeAttribute(item.id)}"
              >
                ${escapeHtml(item.title)}
              </button>
            `).join("")}
          </div>
        </div>
      ` : invalidTimedItems.length ? "" : `
        <div class="recurring-grid-empty-note">Add recurring blocks with times to see them laid out visually here.</div>
      `}
    </div>
  `
}

function renderRecurringList() {
  const container = document.getElementById("recurring-list")
  const count = document.getElementById("recurring-list-count")

  if (!container) return

  const items = Array.isArray(schedulesState.recurring) ? schedulesState.recurring : []

  if (count) {
    count.textContent = `${items.length} ${items.length === 1 ? "block" : "blocks"}`
  }

  if (!items.length) {
    container.innerHTML = '<div class="empty-state">No recurring blocks yet. Add your weekly work, class, or recovery structure here.</div>'
    return
  }

  const orderedItems = [...items].sort((left, right) =>
    Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
    String(left.title || "").localeCompare(String(right.title || ""))
  )

  container.innerHTML = orderedItems.map((item) => {
    const selectedDays = Array.isArray(item.daysOfWeek) ? item.daysOfWeek : []
    const everyDay = SCHEDULE_DAY_ORDER.every((day) => selectedDays.includes(day))
    const weekdaysOnly = ["monday", "tuesday", "wednesday", "thursday", "friday"].every((day) => selectedDays.includes(day)) &&
      !selectedDays.includes("saturday") && !selectedDays.includes("sunday")
    const dayLabel = everyDay
      ? "Every day"
      : weekdaysOnly
        ? "Weekdays"
        : selectedDays.map((day) => SCHEDULE_DAY_LABELS[day] || day).join(", ") || "No days selected"
    const context = [
      item.location || "",
      item.drainLevel && item.drainLevel !== "medium" ? `${item.drainLevel} drain` : "",
      item.flexibility && item.flexibility !== "fixed" ? String(item.flexibility).replaceAll("_", " ") : ""
    ].filter(Boolean)

    return `
      <article class="recurring-card ${getRecurringCategoryClass(item.category)} ${item.active ? "" : "is-inactive"}">
        <div class="recurring-card-main">
          <div class="recurring-card-title-row">
            <span class="recurring-card-accent" aria-hidden="true"></span>
            <h4>${escapeHtml(item.title)}</h4>
            <span class="recurring-card-category">${escapeHtml(item.category || "personal")}</span>
            ${item.active ? "" : '<span class="recurring-card-state">Inactive</span>'}
          </div>
          <p class="recurring-card-schedule">${escapeHtml(dayLabel)} <span aria-hidden="true">·</span> ${escapeHtml(formatTimeRange(item.startTime, item.endTime))}</p>
          ${context.length ? `<p class="recurring-card-context">${escapeHtml(context.join(" · "))}</p>` : ""}
          ${item.notes ? `<p class="recurring-card-notes">${escapeLineBreaks(item.notes)}</p>` : ""}
        </div>
        <div class="recurring-card-actions">
          <button class="button-secondary compact-button" type="button" data-recurring-edit="${escapeAttribute(item.id)}">Edit</button>
          <button class="text-button is-danger" type="button" data-recurring-delete="${escapeAttribute(item.id)}">Delete</button>
        </div>
      </article>
    `
  }).join("")
}

function getRecurringTimeMode() {
  return document.querySelector('input[name="recurring-time-mode"]:checked')?.value || "timed"
}

function getTimeDurationLabel(startTime, endTime) {
  const startMinutes = getMinutesFromTimeString(startTime)
  const endMinutes = getMinutesFromTimeString(endTime)

  if (startMinutes === null || endMinutes === null) {
    return "Choose both a start and end time."
  }

  if (endMinutes <= startMinutes) {
    return "End time must be later than start time. Overnight blocks are not supported yet."
  }

  const duration = endMinutes - startMinutes
  const hours = Math.floor(duration / 60)
  const minutes = duration % 60
  const parts = [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean)
  return `${parts.join(" ")} block`
}

function updateRecurringTimeUi() {
  const mode = getRecurringTimeMode()
  const timeFields = document.getElementById("recurring-time-fields")
  const help = document.getElementById("recurring-time-help")
  const startInput = document.getElementById("recurring-start-time")
  const endInput = document.getElementById("recurring-end-time")
  const isFlexible = mode === "flexible"

  if (timeFields) {
    timeFields.classList.toggle("is-disabled", isFlexible)
  }

  if (startInput) startInput.disabled = isFlexible
  if (endInput) endInput.disabled = isFlexible

  if (help) {
    help.textContent = isFlexible
      ? "This block will appear without a set time."
      : getTimeDurationLabel(startInput?.value, endInput?.value)
    help.classList.toggle(
      "is-error",
      !isFlexible && Boolean(startInput?.value && endInput?.value) &&
        getMinutesFromTimeString(endInput.value) <= getMinutesFromTimeString(startInput.value)
    )
  }
}

function updateRecurringDaysUi() {
  const selectedCount = document.querySelectorAll("[data-recurring-day]:checked").length
  const help = document.getElementById("recurring-days-help")

  if (help) {
    help.textContent = selectedCount
      ? `${selectedCount} ${selectedCount === 1 ? "day" : "days"} selected`
      : "Choose at least one day."
    help.classList.toggle("is-error", selectedCount === 0)
  }
}

function fillRecurringForm(item) {
  const status = document.getElementById("recurring-status")
  if (status) status.textContent = ""
  document.getElementById("recurring-id").value = item?.id || ""
  document.getElementById("recurring-title").value = item?.title || ""
  document.getElementById("recurring-category").value = item?.category || "work"
  document.getElementById("recurring-start-time").value = item?.startTime || ""
  document.getElementById("recurring-end-time").value = item?.endTime || ""
  document.getElementById("recurring-location").value = item?.location || ""
  document.getElementById("recurring-drain-level").value = item?.drainLevel || "medium"
  document.getElementById("recurring-flexibility").value = item?.flexibility || "fixed"
  document.getElementById("recurring-notes").value = item?.notes || ""
  document.getElementById("recurring-active").checked = item?.active !== false
  document.getElementById("recurring-form-title").textContent = item ? "Edit Recurring Block" : "Add Recurring Block"

  const hasFixedTime = Boolean(item?.startTime && item?.endTime)
  document.querySelectorAll('input[name="recurring-time-mode"]').forEach((radio) => {
    radio.checked = radio.value === (item && !hasFixedTime ? "flexible" : "timed")
  })

  const planningDetails = document.getElementById("recurring-planning-details")
  if (planningDetails) {
    planningDetails.open = Boolean(
      item?.location || item?.notes || item?.drainLevel === "high" ||
      item?.drainLevel === "low" || item?.flexibility !== "fixed" || item?.active === false
    )
  }

  document.querySelectorAll("[data-recurring-day]").forEach((checkbox) => {
    checkbox.checked = Boolean(item?.daysOfWeek?.includes(checkbox.value))
  })

  updateRecurringTimeUi()
  updateRecurringDaysUi()
}

function resetRecurringForm() {
  fillRecurringForm(null)
}

function setRecurringEditorOpen(isOpen) {
  schedulesState.recurringEditorOpen = Boolean(isOpen)
  const modal = document.getElementById("recurring-editor-modal")

  if (modal) {
    modal.hidden = !schedulesState.recurringEditorOpen
  }

  updateSchedulesModalState()
}

function setPlanningPreferencesOpen(isOpen) {
  const modal = document.getElementById("planning-preferences-modal")

  if (modal) {
    modal.hidden = !isOpen
  }

  if (isOpen) renderPlanningPreferences()
  updateSchedulesModalState()
}

function updateSchedulesModalState() {
  const hasOpenModal = ["recurring-editor-modal", "planning-preferences-modal"]
    .some((id) => document.getElementById(id)?.hidden === false)
  document.body.classList.toggle("schedules-modal-open", hasOpenModal)
}

function getRecurringFormPayload() {
  const flexibleTime = getRecurringTimeMode() === "flexible"

  return {
    title: document.getElementById("recurring-title").value.trim(),
    category: document.getElementById("recurring-category").value,
    daysOfWeek: Array.from(document.querySelectorAll("[data-recurring-day]:checked")).map((checkbox) => checkbox.value),
    startTime: flexibleTime ? null : document.getElementById("recurring-start-time").value || null,
    endTime: flexibleTime ? null : document.getElementById("recurring-end-time").value || null,
    location: document.getElementById("recurring-location").value.trim() || null,
    drainLevel: document.getElementById("recurring-drain-level").value || "medium",
    flexibility: document.getElementById("recurring-flexibility").value || "fixed",
    notes: document.getElementById("recurring-notes").value.trim() || null,
    active: document.getElementById("recurring-active").checked
  }
}

function normalizePlanningPreferences(raw) {
  return {
    prioritizeRecoveryWhenSymptomsElevated: raw?.prioritizeRecoveryWhenSymptomsElevated !== false,
    preferWorkoutTime: raw?.preferWorkoutTime || "no_preference",
    preferTaskTypeFirst: raw?.preferTaskTypeFirst || "no_preference",
    leaveBufferAfterWork: raw?.leaveBufferAfterWork !== false,
    defaultBufferMins: Number(raw?.defaultBufferMins) || 30,
    avoidIntenseExerciseAfterPoorSleep: raw?.avoidIntenseExerciseAfterPoorSleep !== false,
    preferLighterDaysAfterHighDrainDays: raw?.preferLighterDaysAfterHighDrainDays !== false,
    notes: raw?.notes || ""
  }
}

function renderPlanningPreferences() {
  const preferences = normalizePlanningPreferences(schedulesState.preferences || {})

  document.getElementById("pref-prioritize-recovery").checked = preferences.prioritizeRecoveryWhenSymptomsElevated
  document.getElementById("pref-workout-time").value = preferences.preferWorkoutTime
  document.getElementById("pref-task-type-first").value = preferences.preferTaskTypeFirst
  document.getElementById("pref-default-buffer").value = String(preferences.defaultBufferMins)
  document.getElementById("pref-buffer-after-work").checked = preferences.leaveBufferAfterWork
  document.getElementById("pref-avoid-exercise-poor-sleep").checked = preferences.avoidIntenseExerciseAfterPoorSleep
  document.getElementById("pref-lighter-days").checked = preferences.preferLighterDaysAfterHighDrainDays
  document.getElementById("pref-notes").value = preferences.notes || ""
}

function getDateKeyInAppTimezone(value) {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function getDayNameInAppTimezone(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "long"
  }).format(date).toLowerCase()
}

function getCalendarEventDateKey(event) {
  const value = event?.startTime || event?.endTime
  return event?.allDay ? String(value || "").slice(0, 10) : getDateKeyInAppTimezone(value)
}

function getCombinedCalendarItemsForDate(date) {
  const dateKey = getDateKeyInAppTimezone(date)
  const googleEvents = schedulesState.calendarEvents
    .filter((event) => getCalendarEventDateKey(event) === dateKey)
    .map((event) => ({ ...event, sourceType: "google", dateKey }))
  const dayName = getDayNameInAppTimezone(date)
  const recurringItems = schedulesState.recurring
    .filter((item) => {
      if (!item.active || !Array.isArray(item.daysOfWeek) || !item.daysOfWeek.includes(dayName)) {
        return false
      }

      if (!item.startTime && !item.endTime) {
        return true
      }

      const startMinutes = getMinutesFromTimeString(item.startTime)
      const endMinutes = getMinutesFromTimeString(item.endTime)
      return startMinutes !== null && endMinutes !== null && endMinutes > startMinutes
    })
    .map((item) => ({
      ...item,
      id: `recurring-${item.id}-${dateKey}`,
      recurringId: item.id,
      sourceType: "recurring",
      dateKey,
      allDay: false
    }))

  return [...googleEvents, ...recurringItems].sort((left, right) => {
    const leftTime = left.startTime && !String(left.startTime).includes("T") ? left.startTime : String(left.startTime || "").slice(11, 16)
    const rightTime = right.startTime && !String(right.startTime).includes("T") ? right.startTime : String(right.startTime || "").slice(11, 16)
    return String(leftTime || "99:99").localeCompare(String(rightTime || "99:99"))
  })
}

function getCalendarItemColorClass(item) {
  return item.sourceType === "recurring" ? getRecurringCategoryClass(item.category) : "is-google-event"
}

function getUpcomingWeekDates() {
  const today = new Date()
  const days = []

  for (let index = 0; index < 7; index += 1) {
    const nextDate = new Date(today)
    nextDate.setDate(today.getDate() + index)
    days.push(nextDate)
  }

  return days
}

function renderCalendarWeekGrid() {
  const container = document.getElementById("calendar-week-grid")

  if (!container) {
    return
  }

  const days = getUpcomingWeekDates()

  container.innerHTML = days.map((date) => {
    const events = getCombinedCalendarItemsForDate(date)

    return `
      <section class="calendar-day-card">
        <header>
          <strong>${date.toLocaleDateString([], { timeZone: APP_TIMEZONE, weekday: "short" })}</strong>
          <span>${date.toLocaleDateString([], { timeZone: APP_TIMEZONE, month: "short", day: "numeric" })}</span>
        </header>
        <div class="calendar-day-events">
          ${events.length ? events.map((event) => `
            <article class="calendar-event-card ${escapeAttribute(getCalendarItemColorClass(event))} ${event.sourceType === "recurring" ? "is-recurring" : ""}" style="${escapeAttribute(getCalendarAccentStyle(event))}">
              <div class="calendar-event-time">${escapeHtml(formatTimeRange(event.startTime, event.endTime, event.allDay))}</div>
              <strong>${escapeHtml(event.title)}</strong>
              ${event.location ? `<span class="calendar-event-meta">${escapeHtml(event.location)}</span>` : ""}
              <span class="calendar-event-calendar">${escapeHtml(getCalendarSourceLabel(event))}</span>
              ${event.sourceType === "recurring" ? `<button class="calendar-recurring-edit" type="button" data-recurring-edit="${escapeAttribute(event.recurringId)}">Recurring · Edit</button>` : ""}
            </article>
          `).join("") : '<div class="empty-state compact">Nothing scheduled.</div>'}
        </div>
      </section>
    `
  }).join("")
}

function renderCalendarLegend() {
  const container = document.getElementById("calendar-legend")

  if (!container) {
    return
  }

  const calendarNames = Array.from(new Set(
    (Array.isArray(schedulesState.calendarEvents) ? schedulesState.calendarEvents : [])
      .map((event) => String(event.calendarName || "Google Calendar").trim())
  )).sort((left, right) => left.localeCompare(right))

  const hasRecurring = schedulesState.recurring.some((item) => item.active)

  if (!calendarNames.length && !hasRecurring) {
    container.innerHTML = ""
    return
  }

  container.innerHTML = `${hasRecurring ? `
    <span class="calendar-legend-item">
      <span class="calendar-legend-dot is-recurring"></span>
      <span>Recurring block</span>
    </span>
  ` : ""}${calendarNames.map((name) => `
    <span class="calendar-legend-item">
      <span class="calendar-legend-dot" style="--calendar-accent:${escapeAttribute(getCalendarSourceColor(name))}"></span>
      <span>${escapeHtml(name)}</span>
    </span>
  `).join("")}`
}

function getMonthViewDates() {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstOfMonth = new Date(year, month, 1, 12)
  const start = new Date(firstOfMonth)
  const dayOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - dayOffset)

  return Array.from({ length: 42 }, (_item, index) => {
    const nextDate = new Date(start)
    nextDate.setDate(start.getDate() + index)
    return nextDate
  })
}

function renderCalendarMonthGrid() {
  const container = document.getElementById("calendar-month-grid")

  if (!container) {
    return
  }

  const today = new Date()
  const currentMonth = today.getMonth()
  const dates = getMonthViewDates()

  container.innerHTML = `
    <div class="calendar-month-head">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => `<span>${label}</span>`).join("")}
    </div>
    <div class="calendar-month-cells">
      ${dates.map((date) => {
        const events = getCombinedCalendarItemsForDate(date).slice(0, 4)

        return `
          <section class="calendar-month-cell ${date.getMonth() === currentMonth ? "" : "is-outside-month"}">
            <header>${date.getDate()}</header>
            <div class="calendar-month-events">
              ${events.map((event) => `
                <div class="calendar-month-chip ${escapeAttribute(getCalendarItemColorClass(event))} ${event.sourceType === "recurring" ? "is-recurring" : ""}" style="${escapeAttribute(getCalendarAccentStyle(event))}" title="${escapeAttribute(event.title)}">
                  <span>${escapeHtml(event.title)}</span>
                </div>
              `).join("")}
            </div>
          </section>
        `
      }).join("")}
    </div>
  `
}

function renderCalendarAgenda() {
  const container = document.getElementById("calendar-agenda")

  if (!container) return

  const today = new Date()
  const days = Array.from({ length: 14 }, (_item, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    return {
      date,
      dateKey: getDateKeyInAppTimezone(date),
      events: getCombinedCalendarItemsForDate(date)
    }
  }).filter((day) => day.events.length)

  if (!days.length) {
    container.innerHTML = '<div class="empty-state">No recurring blocks or synced events in the next two weeks.</div>'
    return
  }

  let renderedCount = 0
  container.innerHTML = days.map((day) => {
    const remaining = Math.max(0, 30 - renderedCount)
    const events = day.events.slice(0, remaining)
    renderedCount += events.length

    if (!events.length) return ""

    const weekday = day.date.toLocaleDateString([], { timeZone: APP_TIMEZONE, weekday: "long" })
    const dateLabel = day.date.toLocaleDateString([], { timeZone: APP_TIMEZONE, month: "long", day: "numeric" })

    return `
      <section class="agenda-day-group">
        <header class="agenda-day-heading">
          <strong>${escapeHtml(weekday)}</strong>
          <span>${escapeHtml(dateLabel)}</span>
        </header>
        <div class="agenda-day-events">
          ${events.map((event) => `
            <article class="agenda-item ${escapeAttribute(getCalendarItemColorClass(event))}" style="${escapeAttribute(getCalendarAccentStyle(event))}">
              <time class="agenda-time">${escapeHtml(formatTimeRange(event.startTime, event.endTime, event.allDay))}</time>
              <div class="agenda-body">
                <div class="agenda-title-row">
                  <span class="calendar-legend-dot" style="${escapeAttribute(getCalendarAccentStyle(event))}"></span>
                  <strong>${escapeHtml(event.title)}</strong>
                </div>
                <div class="agenda-details">
                  <span>${escapeHtml(getCalendarSourceLabel(event))}</span>
                  ${event.location ? `<span>${escapeHtml(event.location)}</span>` : ""}
                </div>
              </div>
              ${event.sourceType === "recurring" ? `<button class="text-button agenda-edit" type="button" data-recurring-edit="${escapeAttribute(event.recurringId)}">Edit</button>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
    `
  }).join("")
}

function renderSchedulesPage() {
  renderRecurringWeekGrid()
  renderRecurringList()
  renderPlanningPreferences()
  renderCalendarLegend()
  renderCalendarWeekGrid()
  renderCalendarMonthGrid()
  renderCalendarAgenda()
  setCalendarView(schedulesState.calendarView)
}

function setCalendarView(view) {
  schedulesState.calendarView = view === "month" ? "month" : "week"

  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.calendarView === schedulesState.calendarView)
  })

  document.getElementById("calendar-week-grid")?.toggleAttribute("hidden", schedulesState.calendarView !== "week")
  document.getElementById("calendar-month-grid")?.toggleAttribute("hidden", schedulesState.calendarView !== "month")
}

function setGoogleConnectionUI(status = {}) {
  schedulesState.googleConnected = Boolean(status.connected)
  const badge = document.getElementById("google-status-badge")
  const connectButton = document.getElementById("schedules-google-connect")
  const disconnectButton = document.getElementById("schedules-google-disconnect")

  if (badge) {
    badge.textContent = schedulesState.googleConnected
      ? `Google connected${status.expiryDate ? " · refresh enabled" : ""}`
      : "Google not connected"
    badge.classList.toggle("is-connected", schedulesState.googleConnected)
    badge.classList.toggle("is-idle", !schedulesState.googleConnected)
  }

  if (connectButton) {
    connectButton.hidden = schedulesState.googleConnected
  }

  if (disconnectButton) {
    disconnectButton.hidden = !schedulesState.googleConnected
  }
}

async function loadSchedulesData(options = {}) {
  const sync = options.sync === true
  const status = await fetchJson("/google/status")
  setGoogleConnectionUI(status)

  if (sync && status.connected) {
    const [calendarSync] = await Promise.allSettled([
      fetchJson("/google/sync/calendar", { method: "POST" })
    ])

    if (calendarSync.status === "rejected") {
      showToast(calendarSync.reason?.message || "Calendar sync failed", "error")
    }

  }

  const [recurring, preferences, calendarEvents] = await Promise.all([
    fetchJson("/schedules/recurring"),
    fetchJson("/schedules/preferences"),
    fetchJson("/schedules/calendar")
  ])

  schedulesState.recurring = Array.isArray(recurring) ? recurring : []
  schedulesState.preferences = normalizePlanningPreferences(preferences)
  schedulesState.calendarEvents = Array.isArray(calendarEvents) ? calendarEvents : []
  renderSchedulesPage()
}

function consumeScheduleQueryToasts() {
  const params = new URLSearchParams(window.location.search)

  if (params.get("google_connected") === "1") {
    showToast("Google connected. Calendar is ready to sync.", "success")
  }

  if (params.get("google_error")) {
    showToast(params.get("google_error"), "error")
  }

  if (params.has("google_connected") || params.has("google_error")) {
    params.delete("google_connected")
    params.delete("google_error")
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`
    window.history.replaceState({}, "", nextUrl)
  }
}

async function setupSchedulesPage() {
  await setupShellPage()
  consumeScheduleQueryToasts()
  setSchedulesTab(schedulesState.activeTab)
  resetRecurringForm()
  setRecurringEditorOpen(false)

  document.querySelectorAll("[data-schedules-tab]").forEach((button) => {
    button.addEventListener("click", () => setSchedulesTab(button.dataset.schedulesTab))
  })

  document.getElementById("recurring-open-form")?.addEventListener("click", () => {
    resetRecurringForm()
    setRecurringEditorOpen(true)
    document.getElementById("recurring-title")?.focus()
  })

  document.getElementById("planning-preferences-open")?.addEventListener("click", () => {
    setPlanningPreferencesOpen(true)
    document.getElementById("planning-preferences-close")?.focus()
  })

  document.querySelectorAll("[data-recurring-day]").forEach((checkbox) => {
    checkbox.addEventListener("change", updateRecurringDaysUi)
  })

  document.querySelectorAll("[data-recurring-day-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = button.dataset.recurringDayPreset
      document.querySelectorAll("[data-recurring-day]").forEach((checkbox) => {
        checkbox.checked = preset === "daily" ||
          (preset === "weekdays" && !["saturday", "sunday"].includes(checkbox.value))
      })
      updateRecurringDaysUi()
    })
  })

  document.querySelectorAll('input[name="recurring-time-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateRecurringTimeUi)
  })
  document.getElementById("recurring-start-time")?.addEventListener("input", updateRecurringTimeUi)
  document.getElementById("recurring-end-time")?.addEventListener("input", updateRecurringTimeUi)

  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.addEventListener("click", () => setCalendarView(button.dataset.calendarView))
  })

  document.getElementById("schedules-google-connect")?.addEventListener("click", () => {
    window.location.assign("/auth/google")
  })

  document.getElementById("schedules-google-disconnect")?.addEventListener("click", async () => {
    try {
      await fetchJson("/google/disconnect", { method: "POST" })
      await loadSchedulesData({ sync: false })
      showToast("Google disconnected.", "success")
    } catch (error) {
      showToast(error.message || "Could not disconnect Google", "error")
    }
  })

  document.getElementById("schedules-refresh")?.addEventListener("click", async () => {
    try {
      await loadSchedulesData({ sync: true })

      showToast("Schedules refreshed.", "success")
    } catch (error) {
      showToast(error.message || "Could not refresh schedules", "error")
    }
  })

  document.getElementById("recurring-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    const status = document.getElementById("recurring-status")
    const scheduleId = document.getElementById("recurring-id").value.trim()
    const payload = getRecurringFormPayload()

    if (!payload.title || !payload.daysOfWeek.length) {
      if (status) {
        status.textContent = "Add a title and at least one day."
      }
      return
    }

    if (getRecurringTimeMode() === "timed") {
      const startMinutes = getMinutesFromTimeString(payload.startTime)
      const endMinutes = getMinutesFromTimeString(payload.endTime)

      if (startMinutes === null || endMinutes === null) {
        if (status) status.textContent = "Choose both a start and end time, or select Flexible time."
        updateRecurringTimeUi()
        return
      }

      if (endMinutes <= startMinutes) {
        if (status) status.textContent = "End time must be later than start time."
        updateRecurringTimeUi()
        return
      }
    }

    try {
      if (status) {
        status.textContent = scheduleId ? "Saving changes..." : "Saving block..."
      }

      await fetchJson(scheduleId ? `/schedules/recurring/${encodeURIComponent(scheduleId)}` : "/schedules/recurring", {
        method: scheduleId ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })

      resetRecurringForm()
      setRecurringEditorOpen(false)
      await loadSchedulesData()
      showToast(scheduleId ? "Recurring block updated." : "Recurring block saved.", "success")
    } catch (error) {
      if (status) {
        status.textContent = error.message || "Could not save recurring block."
      }
    }
  })

  const closeRecurringEditor = () => {
    resetRecurringForm()
    setRecurringEditorOpen(false)
    document.getElementById("recurring-status").textContent = ""
  }

  document.getElementById("recurring-cancel")?.addEventListener("click", closeRecurringEditor)
  document.getElementById("recurring-editor-close")?.addEventListener("click", closeRecurringEditor)

  const closePlanningPreferences = () => {
    document.getElementById("planning-preferences-status").textContent = ""
    setPlanningPreferencesOpen(false)
  }

  document.getElementById("planning-preferences-cancel")?.addEventListener("click", closePlanningPreferences)
  document.getElementById("planning-preferences-close")?.addEventListener("click", closePlanningPreferences)
  document.querySelector('[data-close-schedules-modal="recurring"]')?.addEventListener("click", closeRecurringEditor)
  document.querySelector('[data-close-schedules-modal="preferences"]')?.addEventListener("click", closePlanningPreferences)

  document.getElementById("planning-preferences-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    const status = document.getElementById("planning-preferences-status")
    const payload = {
      prioritizeRecoveryWhenSymptomsElevated: document.getElementById("pref-prioritize-recovery").checked,
      preferWorkoutTime: document.getElementById("pref-workout-time").value,
      preferTaskTypeFirst: document.getElementById("pref-task-type-first").value,
      leaveBufferAfterWork: document.getElementById("pref-buffer-after-work").checked,
      defaultBufferMins: Number(document.getElementById("pref-default-buffer").value) || 30,
      avoidIntenseExerciseAfterPoorSleep: document.getElementById("pref-avoid-exercise-poor-sleep").checked,
      preferLighterDaysAfterHighDrainDays: document.getElementById("pref-lighter-days").checked,
      notes: document.getElementById("pref-notes").value.trim()
    }

    try {
      if (status) {
        status.textContent = "Saving preferences..."
      }

      schedulesState.preferences = await fetchJson("/schedules/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
      renderPlanningPreferences()
      closePlanningPreferences()
      showToast("Planning preferences saved.", "success")
    } catch (error) {
      if (status) {
        status.textContent = error.message || "Could not save preferences."
      }
    }
  })

  document.addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-recurring-edit]")
    const deleteButton = event.target.closest("[data-recurring-delete]")

    if (editButton) {
      const schedule = schedulesState.recurring.find((item) => item.id === editButton.dataset.recurringEdit)

      if (schedule) {
        setSchedulesTab("recurring")
        fillRecurringForm(schedule)
        setRecurringEditorOpen(true)
        document.getElementById("recurring-title")?.focus()
      }
    }

    if (deleteButton) {
      const scheduleId = deleteButton.dataset.recurringDelete
      const schedule = schedulesState.recurring.find((item) => item.id === scheduleId)

      if (!schedule || !window.confirm(`Delete "${schedule.title}"?`)) {
        return
      }

      try {
        await fetchJson(`/schedules/recurring/${encodeURIComponent(scheduleId)}`, {
          method: "DELETE"
        })

        if (document.getElementById("recurring-id").value === scheduleId) {
          resetRecurringForm()
          setRecurringEditorOpen(false)
        }

        await loadSchedulesData()
        showToast("Recurring block deleted.", "success")
      } catch (error) {
        showToast(error.message || "Could not delete recurring block", "error")
      }
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return

    if (document.getElementById("recurring-editor-modal")?.hidden === false) {
      closeRecurringEditor()
    } else if (document.getElementById("planning-preferences-modal")?.hidden === false) {
      closePlanningPreferences()
    }
  })

  await loadSchedulesData({ sync: true })
}

function formatCurrency(value) {
  const amount = Number(value || 0)

  if (!Number.isFinite(amount)) {
    return "$0.000000"
  }

  return amount < 0.01 ? `$${amount.toFixed(6)}` : `$${amount.toFixed(4)}`
}

function formatTokenCount(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount.toLocaleString() : "0"
}

function formatLogTimeLabel(value) {
  if (!value) {
    return "--:--"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString([], {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit"
  })
}

function getDevLogsFilters(options = {}) {
  const startDate = document.getElementById("dev-logs-start-date")?.value || ""
  const endDate = document.getElementById("dev-logs-end-date")?.value || ""
  const source = document.getElementById("dev-logs-source")?.value || ""
  const model = document.getElementById("dev-logs-model")?.value || ""
  const status = document.getElementById("dev-logs-status")?.value || "all"
  const search = document.getElementById("dev-logs-search")?.value.trim() || ""

  return {
    startDate,
    endDate,
    source,
    model,
    errorsOnly: status === "errors",
    successOnly: false,
    search,
    limit: options.limit ?? devLogsState.limit,
    offset: options.offset ?? devLogsState.offset
  }
}

function buildDevLogsQuery(filters) {
  const params = new URLSearchParams()

  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === "" || value === null || value === undefined || value === false) {
      return
    }

    params.set(key, String(value))
  })

  return params.toString()
}

function setDevLogsListMeta(message) {
  const node = document.getElementById("dev-logs-list-meta")

  if (node) {
    node.textContent = message
  }
}

function renderDevLogsSummary() {
  const summary = devLogsState.summary

  if (!summary) {
    return
  }

  const today = document.getElementById("dev-logs-summary-today")
  const last7 = document.getElementById("dev-logs-summary-7d")
  const last30 = document.getElementById("dev-logs-summary-30d")

  if (today) {
    today.textContent = `${summary.today.calls} calls | ${formatTokenCount(summary.today.totalTokens)} tokens | ${formatCurrency(summary.today.estimatedCost)}`
  }

  if (last7) {
    last7.textContent = `${summary.last7Days.calls} calls | ${formatCurrency(summary.last7Days.estimatedCost)}`
  }

  if (last30) {
    last30.textContent = `${summary.last30Days.calls} calls | ${formatCurrency(summary.last30Days.estimatedCost)}`
  }
}

async function loadDevLogsSummary() {
  try {
    devLogsState.summary = await fetchJson("/dev/logs/summary")
    renderDevLogsSummary()
  } catch (error) {
    ;["dev-logs-summary-today", "dev-logs-summary-7d", "dev-logs-summary-30d"].forEach((id) => {
      const node = document.getElementById(id)
      if (node) node.textContent = "Summary unavailable"
    })
  }
}

function renderDevLogsPagination() {
  const previous = document.getElementById("dev-logs-previous")
  const next = document.getElementById("dev-logs-next")
  const page = document.getElementById("dev-logs-page")
  if (previous) previous.disabled = devLogsState.loadingList || devLogsState.offset === 0
  if (next) next.disabled = devLogsState.loadingList || !devLogsState.hasMore
  if (page) page.textContent = `Page ${Math.floor(devLogsState.offset / devLogsState.limit) + 1}`
}

function renderDevLogsList() {
  const list = document.getElementById("dev-logs-list")
  renderDevLogsPagination()

  if (!list) {
    return
  }

  if (!devLogsState.items.length) {
    const filters = getDevLogsFilters()
    const hasFilters = filters.startDate || filters.endDate || filters.source || filters.model || filters.errorsOnly || filters.search
    list.innerHTML = `<div class="empty-state">${hasFilters
      ? "No API calls match your filters. Try adjusting or clearing them."
      : "No API calls logged yet. Logs will appear here as you use Boris."}</div>`
    setDevLogsListMeta("0 logs")
    return
  }

  list.innerHTML = devLogsState.items.map((item) => `
    <button
      class="dev-log-row ${devLogsState.selectedId === item.id ? "is-active" : ""}"
      type="button"
      data-dev-log-id="${escapeAttribute(item.id)}"
    >
      <div class="dev-log-row-topline">
        <span class="dev-log-row-time">[${escapeHtml(formatLogTimeLabel(item.createdAt))}]</span>
        <span class="dev-log-row-status ${item.success ? "is-success" : "is-error"}">${item.success ? "✓" : "✗"}</span>
      </div>
      <div class="dev-log-row-main">
        <div class="dev-log-row-text">
          <strong>${escapeHtml(item.label || "Unlabeled")}</strong>
          <span>${escapeHtml(item.model || "--")}</span>
        </div>
        <div class="dev-log-row-metrics">
          <span>${formatTokenCount(item.totalTokens)} tok</span>
          <strong>${escapeHtml(formatCurrency(item.estimatedCostUsd))}</strong>
        </div>
      </div>
      <p class="dev-log-row-preview">${escapeHtml(String(item.outputText || item.errorMessage || "").trim().slice(0, 160) || "No output preview available.")}</p>
      <div class="dev-log-row-bottom">
        <span>${escapeHtml(item.source || "unknown")}</span>
        ${item.truncatedAt ? '<span class="dev-log-row-truncated">Truncated</span>' : ""}
      </div>
    </button>
  `).join("")

  setDevLogsListMeta(`Calls ${devLogsState.offset + 1}–${devLogsState.offset + devLogsState.items.length}`)
}

function renderDevLogDetail(log) {
  const detail = document.getElementById("dev-logs-detail")

  if (!detail) {
    return
  }

  if (!log) {
    detail.innerHTML = '<div class="empty-state">Select a log to inspect its prompt, response, token usage, and metadata.</div>'
    return
  }

  const truncatedBanner = log.truncatedAt
    ? `<div class="dev-logs-truncated-banner">Full prompt and output truncated on ${escapeHtml(formatTimestampLabel(log.truncatedAt))} — token and cost data preserved.</div>`
    : ""
  const inputText = log.inputText
    ? `<pre class="dev-logs-code-block"><code>${escapeHtml(log.inputText)}</code></pre>`
    : '<div class="empty-state compact">Prompt unavailable.</div>'
  const outputText = log.outputText
    ? `<div class="dev-logs-output">${renderRichMarkdown(log.outputText)}</div>`
    : '<div class="empty-state compact">Output unavailable.</div>'
  const metadata = log.metadata ? escapeHtml(JSON.stringify(log.metadata, null, 2)) : "{}"

  detail.innerHTML = `
    <div class="dev-logs-detail-header">
      <div>
        <p class="eyebrow">Request Detail</p>
        <h3>${escapeHtml(log.label || "Unlabeled")}</h3>
      </div>
      <span class="dev-log-row-status ${log.success ? "is-success" : "is-error"}">${log.success ? "Success" : "Error"}</span>
    </div>

    ${truncatedBanner}

    <div class="dev-logs-detail-grid">
      <div class="dev-logs-detail-item"><span>Label</span><strong>${escapeHtml(log.label || "--")}</strong></div>
      <div class="dev-logs-detail-item"><span>Source</span><strong>${escapeHtml(log.source || "--")}</strong></div>
      <div class="dev-logs-detail-item"><span>Model</span><strong>${escapeHtml(log.model || "--")}</strong></div>
      <div class="dev-logs-detail-item"><span>Time</span><strong>${escapeHtml(formatTimestampLabel(log.createdAt))}</strong></div>
      <div class="dev-logs-detail-item"><span>Latency</span><strong>${log.latencyMs ? `${formatTokenCount(log.latencyMs)}ms` : "--"}</strong></div>
      <div class="dev-logs-detail-item"><span>Session</span><strong>${escapeHtml(log.sessionId || "--")}</strong></div>
    </div>

    <div class="dev-logs-token-row">
      <strong>Tokens:</strong>
      <span>Input: ${formatTokenCount(log.inputTokens)}</span>
      <span>Cached: ${formatTokenCount(log.cachedTokens)}</span>
      <span>Output: ${formatTokenCount(log.outputTokens)}</span>
      <span>Total: ${formatTokenCount(log.totalTokens)}</span>
    </div>

    <div class="dev-logs-cost-row">
      <strong>Cost:</strong>
      <span>${escapeHtml(formatCurrency(log.estimatedCostUsd))}</span>
      ${log.errorMessage ? `<span class="dev-logs-error-copy">${escapeHtml(log.errorMessage)}</span>` : ""}
    </div>

    <section class="dev-logs-section">
      <h4>Input Prompt</h4>
      ${inputText}
    </section>

    <section class="dev-logs-section">
      <h4>Output</h4>
      ${outputText}
    </section>

    <section class="dev-logs-section">
      <h4>Metadata</h4>
      <pre class="dev-logs-code-block"><code>${metadata}</code></pre>
    </section>
  `
}

async function loadDevLogDetail(id) {
  if (!id) {
    renderDevLogDetail(null)
    return
  }

  devLogsState.selectedId = id
  renderDevLogsList()
  const detail = document.getElementById("dev-logs-detail")
  if (detail) detail.innerHTML = '<div class="empty-state" role="status">Loading log details...</div>'

  try {
    const record = await fetchJson(`/dev/logs/${encodeURIComponent(id)}`)
    if (devLogsState.selectedId === id) renderDevLogDetail(record)
  } catch (error) {
    if (detail && devLogsState.selectedId === id) {
      detail.innerHTML = '<div class="empty-state" role="alert">Could not load this log. Select it again to retry.</div>'
    }
  }
}

async function loadDevLogs(options = {}) {
  const reset = options.reset !== false
  if (devLogsState.loadingList && !reset) return

  const requestId = ++devLogsState.listRequestId
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit ?? devLogsState.limit) || 20)))
  const offset = reset ? 0 : Math.max(0, options.offset ?? devLogsState.offset)

  if (reset) {
    devLogsState.offset = 0
    devLogsState.limit = limit
    devLogsState.items = []
    devLogsState.hasMore = false
    devLogsState.selectedId = null
    renderDevLogDetail(null)
    const list = document.getElementById("dev-logs-list")
    if (list) list.innerHTML = '<div class="empty-state" role="status">Loading API calls...</div>'
  }

  const pageSize = document.getElementById("dev-logs-page-size")
  if (pageSize) pageSize.value = String(limit)
  devLogsState.loadingList = true
  setDevLogsListMeta("Loading logs...")
  renderDevLogsPagination()

  try {
    // Fetch one extra call so Next is disabled on a full final page too.
    const filters = getDevLogsFilters({ limit: limit + 1, offset })
    const query = buildDevLogsQuery(filters)
    const logs = await fetchJson(`/dev/logs?${query}`)
    if (requestId !== devLogsState.listRequestId) return
    if (!Array.isArray(logs)) throw new Error("Invalid API log response")

    devLogsState.items = logs.slice(0, limit)
    devLogsState.hasMore = logs.length > limit
    devLogsState.offset = offset
    devLogsState.selectedId = null
    renderDevLogsList()
    renderDevLogDetail(null)

    if (devLogsState.items.length) {
      await loadDevLogDetail(devLogsState.items[0].id)
    }
  } catch (error) {
    if (requestId !== devLogsState.listRequestId) return
    renderDevLogsList()
    setDevLogsListMeta("Could not load logs. Please retry.")
    if (!devLogsState.items.length) {
      const list = document.getElementById("dev-logs-list")
      if (list) {
        list.innerHTML = '<div class="empty-state" role="alert">API calls could not be loaded. <button class="button-secondary" type="button" data-dev-logs-retry>Retry</button></div>'
      }
    }
  } finally {
    if (requestId === devLogsState.listRequestId) {
      devLogsState.loadingList = false
      renderDevLogsPagination()
    }
  }
}

function convertLogsToCsvRows(items) {
  const headers = [
    "created_at",
    "label",
    "source",
    "model",
    "success",
    "latency_ms",
    "input_tokens",
    "cached_tokens",
    "output_tokens",
    "total_tokens",
    "estimated_cost_usd",
    "session_id",
    "error_message",
    "truncated_at",
    "input_text",
    "output_text"
  ]
  const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const rows = [headers.join(",")]

  ;(Array.isArray(items) ? items : []).forEach((item) => {
    rows.push([
      item.createdAt,
      item.label,
      item.source,
      item.model,
      item.success,
      item.latencyMs,
      item.inputTokens,
      item.cachedTokens,
      item.outputTokens,
      item.totalTokens,
      item.estimatedCostUsd,
      item.sessionId,
      item.errorMessage,
      item.truncatedAt,
      item.inputText,
      item.outputText
    ].map(escapeCsv).join(","))
  })

  return rows.join("\n")
}

function downloadCsv(content, fileName) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function exportDevLogsCsv() {
  const filters = getDevLogsFilters({ limit: 500, offset: 0 })
  const query = buildDevLogsQuery(filters)
  const logs = await fetchJson(`/dev/logs${query ? `?${query}` : ""}`)
  downloadCsv(convertLogsToCsvRows(logs), `boris-dev-logs-${getTodayDateString()}.csv`)
}

async function setupDevLogsPage() {
  await setupShellPage()
  renderDevLogDetail(null)

  document.getElementById("dev-logs-list")?.addEventListener("click", async (event) => {
    if (event.target.closest("[data-dev-logs-retry]")) {
      await loadDevLogs({ reset: true })
      return
    }

    const button = event.target.closest("[data-dev-log-id]")

    if (!button) {
      return
    }

    await loadDevLogDetail(button.dataset.devLogId)
  })

  document.getElementById("dev-logs-previous")?.addEventListener("click", async () => {
    if (devLogsState.offset === 0) return
    await loadDevLogs({ reset: false, offset: devLogsState.offset - devLogsState.limit })
  })

  document.getElementById("dev-logs-next")?.addEventListener("click", async () => {
    if (!devLogsState.hasMore) return
    await loadDevLogs({ reset: false, offset: devLogsState.offset + devLogsState.limit })
  })

  document.getElementById("dev-logs-page-size")?.addEventListener("change", async () => {
    const limit = document.getElementById("dev-logs-page-size").value
    await loadDevLogs({ reset: true, limit })
  })

  document.getElementById("dev-logs-clear")?.addEventListener("click", async () => {
    document.getElementById("dev-logs-start-date").value = ""
    document.getElementById("dev-logs-end-date").value = ""
    document.getElementById("dev-logs-source").value = ""
    document.getElementById("dev-logs-model").value = ""
    document.getElementById("dev-logs-status").value = "all"
    document.getElementById("dev-logs-search").value = ""
    await loadDevLogs({ reset: true })
  })

  document.getElementById("dev-logs-export")?.addEventListener("click", async () => {
    try {
      await exportDevLogsCsv()
      showToast("Logs exported.", "success")
    } catch (error) {
      showToast(error.message || "Could not export logs", "error")
    }
  })

  document.getElementById("dev-logs-truncate")?.addEventListener("click", async () => {
    try {
      const response = await fetchJson("/dev/logs/truncate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          daysToKeep: 30
        })
      })
      showToast(`${response.truncatedCount || 0} logs truncated.`, "success")
      await loadDevLogs({ reset: true })
      await loadDevLogsSummary()
    } catch (error) {
      showToast(error.message || "Could not truncate logs", "error")
    }
  })

  const refreshFilters = async () => {
    await loadDevLogs({ reset: true })
  }

  ;[
    "dev-logs-start-date",
    "dev-logs-end-date",
    "dev-logs-source",
    "dev-logs-model",
    "dev-logs-status"
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", refreshFilters)
  })

  document.getElementById("dev-logs-search")?.addEventListener("input", async () => {
    window.clearTimeout(devLogsState.searchTimer)
    devLogsState.searchTimer = window.setTimeout(refreshFilters, 220)
  })

  await Promise.all([loadDevLogsSummary(), loadDevLogs({ reset: true })])
}

function formatAutomationTime(value) {
  const [hourValue, minute = "00"] = String(value || "").split(":")
  const hour = Number(hourValue)
  if (!Number.isFinite(hour)) return value || "—"
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`
}

function formatAutomationDate(value) {
  if (!value) return "—"
  const [year, month, day] = String(value).split("-").map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1, 12)
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
}

function formatAutomationSchedule(item) {
  if (item.scheduleType === "once") {
    const occurrence = item.occurrences?.[0]
    return occurrence ? `${formatAutomationDate(occurrence.date)} at ${formatAutomationTime(occurrence.time)}` : "No time set"
  }
  if (item.scheduleType === "multiple") {
    const occurrences = item.occurrences || []
    return `${occurrences.length} scheduled ${occurrences.length === 1 ? "delivery" : "deliveries"}`
  }
  const labels = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" }
  const days = (item.daysOfWeek || []).map((day) => labels[day] || day).join(", ")
  const times = (item.timesOfDay || []).map(formatAutomationTime).join(", ")
  return `${days || "No days"} at ${times || "no time"}`
}

function renderAutomationSummary() {
  const active = automationsState.items.filter((item) => item.enabled)
  const next = active.filter((item) => item.nextRunAt).sort((left, right) => new Date(left.nextRunAt) - new Date(right.nextRunAt))[0]
  document.getElementById("automation-active-count").textContent = String(active.length)
  document.getElementById("automation-next-run").textContent = next ? formatTimestampLabel(next.nextRunAt) : "None scheduled"
  document.getElementById("automation-timezone").textContent = automationsState.status.timezone || APP_TIMEZONE
}

function renderAutomations() {
  const list = document.getElementById("automation-list")
  if (!list) return

  renderAutomationSummary()
  if (!automationsState.items.length) {
    list.innerHTML = '<div class="empty-state">No automations yet. Create one here or ask Boris in chat.</div>'
    return
  }

  list.innerHTML = automationsState.items.map((item) => {
    const typeLabel = item.type === "morning_brief" ? "Morning brief" : "Reminder"
    const message = item.type === "morning_brief"
      ? item.instructions || "Health-aware guidance based on your current data."
      : item.message
    const status = item.enabled ? "Active" : "Paused"
    const nextRun = item.nextRunAt ? `Next: ${formatTimestampLabel(item.nextRunAt)}` : "No future delivery"
    const lastRun = item.lastRunAt ? `Last: ${formatTimestampLabel(item.lastRunAt)}` : "Not run yet"
    return `
      <article class="automation-card ${item.enabled ? "" : "is-paused"}" data-automation-id="${escapeHtml(item.id)}">
        <div class="automation-card-main">
          <div class="automation-card-heading"><h4>${escapeHtml(item.name)}</h4><span class="automation-type-pill">${typeLabel}</span><span class="automation-status-pill ${item.enabled ? "is-active" : ""}">${status}</span></div>
          <p class="automation-card-schedule">${escapeHtml(formatAutomationSchedule(item))}</p>
          <p class="automation-card-message">${escapeHtml(message || "")}</p>
          <p class="automation-card-meta"><span>${escapeHtml(nextRun)}</span><span>${escapeHtml(lastRun)}</span>${item.lastStatus ? `<span class="automation-status-pill is-${escapeHtml(item.lastStatus)}">${escapeHtml(item.lastStatus)}</span>` : ""}${item.lastError ? `<span class="automation-card-error">${escapeHtml(item.lastError)}</span>` : ""}</p>
        </div>
        <div class="automation-card-actions">
          <button class="button-secondary compact-button" type="button" data-automation-action="history">History</button>
          <button class="button-secondary compact-button" type="button" data-automation-action="run">Run now</button>
          <button class="button-secondary compact-button" type="button" data-automation-action="toggle">${item.enabled ? "Pause" : "Enable"}</button>
          <button class="button-secondary compact-button" type="button" data-automation-action="edit">Edit</button>
          <button class="icon-button icon-button-danger" type="button" data-automation-action="delete" aria-label="Delete ${escapeHtml(item.name)}">×</button>
        </div>
      </article>`
  }).join("")
}

function renderAutomationOccurrences(occurrences = []) {
  const container = document.getElementById("automation-occurrences")
  const scheduleType = document.getElementById("automation-schedule-type")?.value || "once"
  const rows = occurrences.length ? occurrences : [{ date: getTodayDateString(), time: "09:00" }]
  container.innerHTML = rows.map((item, index) => `
    <div class="automation-time-row">
      <input type="date" value="${escapeHtml(item.date || "")}" data-automation-occurrence-date aria-label="Delivery date ${index + 1}" required />
      <input type="time" value="${escapeHtml(item.time || "")}" data-automation-occurrence-time aria-label="Delivery time ${index + 1}" required />
      <button class="automation-time-remove" type="button" data-remove-occurrence ${scheduleType === "once" || rows.length === 1 ? "disabled" : ""} aria-label="Remove delivery time">×</button>
    </div>`).join("")
}

function renderAutomationTimes(times = []) {
  const container = document.getElementById("automation-times")
  const values = times.length ? times : ["09:00"]
  container.innerHTML = values.map((time, index) => `
    <div class="automation-time-row is-time-only">
      <input type="time" value="${escapeHtml(time)}" data-automation-time aria-label="Recurring time ${index + 1}" required />
      <button class="automation-time-remove" type="button" data-remove-time ${values.length === 1 ? "disabled" : ""} aria-label="Remove recurring time">×</button>
    </div>`).join("")
}

function updateAutomationFormSections() {
  const type = document.getElementById("automation-type")?.value
  const scheduleType = document.getElementById("automation-schedule-type")?.value
  const recurring = scheduleType === "recurring"
  document.getElementById("automation-message-field").hidden = type !== "reminder"
  document.getElementById("automation-instructions-field").hidden = type !== "morning_brief"
  document.getElementById("automation-occurrence-section").hidden = recurring
  document.getElementById("automation-recurring-section").hidden = !recurring
  document.getElementById("automation-add-occurrence").hidden = scheduleType !== "multiple"
  document.getElementById("automation-occurrence-title").textContent = scheduleType === "multiple" ? "Delivery times" : "Delivery time"
  document.getElementById("automation-occurrence-help").textContent = scheduleType === "multiple" ? "Choose each specific date and time." : "Choose the date and time."
  if (!recurring) renderAutomationOccurrences(scheduleType === "once" ? [collectAutomationOccurrences()[0] || { date: getTodayDateString(), time: "09:00" }] : collectAutomationOccurrences())
}

function collectAutomationOccurrences() {
  return [...document.querySelectorAll("#automation-occurrences .automation-time-row")].map((row) => ({
    date: row.querySelector("[data-automation-occurrence-date]")?.value || "",
    time: row.querySelector("[data-automation-occurrence-time]")?.value || ""
  }))
}

function openAutomationEditor(item = null) {
  const form = document.getElementById("automation-form")
  form.reset()
  document.getElementById("automation-id").value = item?.id || ""
  document.getElementById("automation-editor-title").textContent = item ? "Edit Automation" : "New Automation"
  document.getElementById("automation-type").value = item?.type || "reminder"
  document.getElementById("automation-name").value = item?.name || ""
  document.getElementById("automation-message").value = item?.message || ""
  document.getElementById("automation-instructions").value = item?.instructions || ""
  document.getElementById("automation-schedule-type").value = item?.scheduleType || "once"
  document.getElementById("automation-start-date").value = item?.startDate || ""
  document.getElementById("automation-end-date").value = item?.endDate || ""
  document.getElementById("automation-enabled").checked = item?.enabled !== false
  document.querySelectorAll("[data-automation-day]").forEach((input) => { input.checked = (item?.daysOfWeek || []).includes(input.value) })
  renderAutomationOccurrences(item?.occurrences || [{ date: getTodayDateString(), time: "09:00" }])
  renderAutomationTimes(item?.timesOfDay || ["09:00"])
  updateAutomationFormSections()
  document.getElementById("automation-form-status").textContent = ""
  document.getElementById("automation-editor-modal").hidden = false
  document.body.classList.add("automations-modal-open")
  window.setTimeout(() => document.getElementById("automation-name")?.focus(), 0)
}

function closeAutomationEditor() {
  document.getElementById("automation-editor-modal").hidden = true
  document.body.classList.remove("automations-modal-open")
}

function collectAutomationForm() {
  const type = document.getElementById("automation-type").value
  const scheduleType = document.getElementById("automation-schedule-type").value
  return {
    type,
    name: document.getElementById("automation-name").value.trim(),
    message: type === "reminder" ? document.getElementById("automation-message").value.trim() : null,
    instructions: type === "morning_brief" ? document.getElementById("automation-instructions").value.trim() : null,
    scheduleType,
    occurrences: scheduleType === "recurring" ? [] : collectAutomationOccurrences(),
    daysOfWeek: scheduleType === "recurring" ? [...document.querySelectorAll("[data-automation-day]:checked")].map((input) => input.value) : [],
    timesOfDay: scheduleType === "recurring" ? [...document.querySelectorAll("[data-automation-time]")].map((input) => input.value) : [],
    startDate: scheduleType === "recurring" ? document.getElementById("automation-start-date").value || null : null,
    endDate: scheduleType === "recurring" ? document.getElementById("automation-end-date").value || null : null,
    timezone: automationsState.status.timezone || APP_TIMEZONE,
    enabled: document.getElementById("automation-enabled").checked
  }
}

async function loadAutomations() {
  const [status, payload] = await Promise.all([
    fetchJson("/api/automations/status"),
    fetchJson("/api/automations")
  ])
  automationsState.status = status
  automationsState.items = payload.automations || []
  const delivery = document.getElementById("automation-delivery-status")
  delivery.textContent = status.telegramConfigured ? "Telegram connected" : "Telegram not configured"
  delivery.className = `automation-connection ${status.telegramConfigured ? "is-ready" : "is-missing"}`
  renderAutomations()
}

async function openAutomationHistory(item) {
  const modal = document.getElementById("automation-history-modal")
  const list = document.getElementById("automation-history-list")
  document.getElementById("automation-history-title").textContent = `${item.name} history`
  list.innerHTML = '<div class="empty-state">Loading history…</div>'
  modal.hidden = false
  document.body.classList.add("automations-modal-open")
  try {
    const payload = await fetchJson(`/api/automations/${encodeURIComponent(item.id)}/runs`)
    list.innerHTML = payload.runs?.length ? payload.runs.map((run) => `
      <div class="automation-history-row"><span>${escapeHtml(formatTimestampLabel(run.scheduledFor))}</span><span class="automation-status-pill is-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span><span class="automation-history-copy">${escapeHtml(run.errorMessage || run.messageText || "No message recorded")}</span></div>`).join("") : '<div class="empty-state">This automation has not run yet.</div>'
  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`
  }
}

function closeAutomationHistory() {
  document.getElementById("automation-history-modal").hidden = true
  document.body.classList.remove("automations-modal-open")
}

async function setupAutomationsPage() {
  await setupShellPage()
  document.getElementById("automation-new")?.addEventListener("click", () => openAutomationEditor())
  document.querySelectorAll("[data-automation-close]").forEach((button) => button.addEventListener("click", closeAutomationEditor))
  document.querySelectorAll("[data-history-close]").forEach((button) => button.addEventListener("click", closeAutomationHistory))
  document.getElementById("automation-type")?.addEventListener("change", updateAutomationFormSections)
  document.getElementById("automation-schedule-type")?.addEventListener("change", updateAutomationFormSections)
  document.getElementById("automation-add-occurrence")?.addEventListener("click", () => renderAutomationOccurrences([...collectAutomationOccurrences(), { date: getTodayDateString(), time: "09:00" }]))
  document.getElementById("automation-add-time")?.addEventListener("click", () => renderAutomationTimes([...document.querySelectorAll("[data-automation-time]")].map((input) => input.value).concat("09:00")))
  document.getElementById("automation-occurrences")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-occurrence]")) return
    const rows = collectAutomationOccurrences()
    const index = [...document.querySelectorAll("#automation-occurrences .automation-time-row")].indexOf(event.target.closest(".automation-time-row"))
    rows.splice(index, 1)
    renderAutomationOccurrences(rows)
  })
  document.getElementById("automation-times")?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-remove-time]")) return
    const rows = [...document.querySelectorAll("[data-automation-time]")].map((input) => input.value)
    const index = [...document.querySelectorAll("#automation-times .automation-time-row")].indexOf(event.target.closest(".automation-time-row"))
    rows.splice(index, 1)
    renderAutomationTimes(rows)
  })
  document.querySelectorAll("[data-automation-day-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = button.dataset.automationDayPreset
    document.querySelectorAll("[data-automation-day]").forEach((input) => {
      input.checked = preset === "daily" || (preset === "weekdays" && !["saturday", "sunday"].includes(input.value))
    })
  }))
  document.getElementById("automation-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    const id = document.getElementById("automation-id").value
    const status = document.getElementById("automation-form-status")
    const save = document.getElementById("automation-save")
    status.textContent = "Saving…"
    save.disabled = true
    try {
      await fetchJson(id ? `/api/automations/${encodeURIComponent(id)}` : "/api/automations", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectAutomationForm())
      })
      closeAutomationEditor()
      await loadAutomations()
      showToast(id ? "Automation updated" : "Automation created", "success")
    } catch (error) {
      status.textContent = error.message
    } finally {
      save.disabled = false
    }
  })
  document.getElementById("automation-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-automation-action]")
    if (!button) return
    const id = button.closest("[data-automation-id]")?.dataset.automationId
    const item = automationsState.items.find((candidate) => candidate.id === id)
    if (!item) return
    const action = button.dataset.automationAction
    if (action === "edit") return openAutomationEditor(item)
    if (action === "history") return openAutomationHistory(item)
    if (action === "delete") {
      if (!window.confirm(`Delete “${item.name}”?`)) return
      await fetchJson(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" })
      await loadAutomations()
      return showToast("Automation deleted", "success")
    }
    button.disabled = true
    try {
      if (action === "toggle") {
        await fetchJson(`/api/automations/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !item.enabled }) })
        showToast(item.enabled ? "Automation paused" : "Automation enabled", "success")
      } else if (action === "run") {
        const payload = await fetchJson(`/api/automations/${encodeURIComponent(id)}/run`, { method: "POST" })
        showToast(payload.result?.status === "sent" ? "Telegram message sent" : payload.result?.error || "Delivery failed", payload.result?.status === "sent" ? "success" : "error")
      }
      await loadAutomations()
    } catch (error) {
      showToast(error.message, "error")
    } finally {
      button.disabled = false
    }
  })
  await loadAutomations()
}

const TREND_SVG_NS = "http://www.w3.org/2000/svg"
const TREND_CHART_SIZE = { width: 800, height: 280, top: 16, right: 16, bottom: 38, left: 42 }
const TREND_SCORE_SERIES = [
  { key: "mood", label: "Mood", color: "var(--trend-series-1)" },
  { key: "energy", label: "Energy (daily average)", color: "var(--trend-series-2)" },
  { key: "stress", label: "Stress", color: "var(--trend-series-3)" }
]

function createTrendSvgElement(tag, attributes = {}) {
  const element = document.createElementNS(TREND_SVG_NS, tag)
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
  return element
}

function formatTrendDate(value, options = {}) {
  const [year, month, day] = String(value || "").split("-").map(Number)
  const date = new Date(year || 0, (month || 1) - 1, day || 1, 12)
  if (Number.isNaN(date.getTime())) return String(value || "")
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: options.year ? "numeric" : undefined
  })
}

function trendValue(value) {
  const number = Number(value)
  return value === null || value === undefined || !Number.isFinite(number) ? null : number
}

function createTrendChart(containerId, options = {}) {
  const container = document.getElementById(containerId)
  if (!container) return null
  container.replaceChildren()
  const shell = document.createElement("div")
  shell.className = "trend-svg-shell"
  if (options.pixelWidth) shell.style.width = `${options.pixelWidth}px`
  const svg = createTrendSvgElement("svg", {
    viewBox: `0 0 ${options.width || TREND_CHART_SIZE.width} ${TREND_CHART_SIZE.height}`,
    role: "img",
    "aria-label": options.label || container.getAttribute("aria-label") || "Trend chart"
  })
  const tooltip = document.createElement("div")
  tooltip.className = "trend-tooltip"
  tooltip.setAttribute("role", "tooltip")
  tooltip.hidden = true
  shell.append(svg, tooltip)
  container.appendChild(shell)
  return { container, shell, svg, tooltip }
}

function renderTrendEmpty(containerId, message) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.replaceChildren()
  const empty = document.createElement("div")
  empty.className = "trend-empty-state"
  empty.textContent = message
  container.appendChild(empty)
}

function getTrendPlot(size = TREND_CHART_SIZE) {
  return {
    left: size.left,
    top: size.top,
    right: size.width - size.right,
    bottom: size.height - size.bottom,
    width: size.width - size.left - size.right,
    height: size.height - size.top - size.bottom
  }
}

function appendTrendAxes(svg, size, maxY, yTicks, xItems, xLabel, banded = false) {
  const plot = getTrendPlot(size)
  const tickCount = Math.max(1, yTicks)
  for (let index = 0; index <= tickCount; index += 1) {
    const ratio = index / tickCount
    const y = plot.bottom - ratio * plot.height
    svg.appendChild(createTrendSvgElement("line", {
      class: "trend-gridline",
      x1: plot.left,
      x2: plot.right,
      y1: y,
      y2: y
    }))
    const label = createTrendSvgElement("text", {
      class: "trend-axis-label",
      x: plot.left - 9,
      y: y + 4,
      "text-anchor": "end"
    })
    const value = maxY * ratio
    label.textContent = Number.isInteger(value) ? String(value) : value.toFixed(1)
    svg.appendChild(label)
  }
  svg.appendChild(createTrendSvgElement("line", {
    class: "trend-axis-line",
    x1: plot.left,
    x2: plot.right,
    y1: plot.bottom,
    y2: plot.bottom
  }))

  if (!xItems.length) return
  const labelInterval = Math.max(1, Math.ceil(xItems.length / 6))
  const labeled = new Set()
  xItems.forEach((item, index) => {
    if (index % labelInterval !== 0 && index !== xItems.length - 1) return
    if (labeled.has(index)) return
    labeled.add(index)
    const x = banded
      ? plot.left + ((index + 0.5) / xItems.length) * plot.width
      : xItems.length === 1
        ? plot.left + plot.width / 2
        : plot.left + (index / (xItems.length - 1)) * plot.width
    const label = createTrendSvgElement("text", {
      class: "trend-axis-label",
      x,
      y: plot.bottom + 24,
      "text-anchor": "middle"
    })
    label.textContent = xLabel(item)
    svg.appendChild(label)
  })
}

function renderTrendLegend(containerId, series) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.replaceChildren()
  for (const item of series) {
    const entry = document.createElement("span")
    entry.className = "trend-legend-item"
    const swatch = document.createElement("i")
    swatch.className = "trend-legend-swatch"
    swatch.style.background = item.color
    const label = document.createElement("span")
    label.textContent = item.label
    entry.append(swatch, label)
    container.appendChild(entry)
  }
}

function showTrendTooltip(tooltip, title, rows, position) {
  tooltip.replaceChildren()
  const heading = document.createElement("div")
  heading.className = "trend-tooltip-title"
  heading.textContent = title
  tooltip.appendChild(heading)

  for (const row of rows) {
    const line = document.createElement("div")
    line.className = "trend-tooltip-row"
    const swatch = document.createElement("i")
    swatch.className = "trend-tooltip-swatch"
    swatch.style.background = row.color || "var(--trend-axis)"
    const label = document.createElement("span")
    label.textContent = row.label
    const value = document.createElement("strong")
    value.textContent = row.value
    line.append(swatch, label, value)
    tooltip.appendChild(line)
  }

  tooltip.hidden = false
  tooltip.classList.toggle("is-left", position.xRatio > 0.68)
  tooltip.style.left = `${position.xRatio * 100}%`
  tooltip.style.top = `${Math.max(0.12, Math.min(0.88, position.yRatio)) * 100}%`
}

function hideTrendTooltip(tooltip, crosshair = null) {
  tooltip.hidden = true
  if (crosshair) crosshair.hidden = true
}

function addTrendLineHover({ svg, tooltip, rows, series, size, valueFormatter, extraRows }) {
  const plot = getTrendPlot(size)
  const crosshair = createTrendSvgElement("line", {
    class: "trend-crosshair",
    y1: plot.top,
    y2: plot.bottom
  })
  crosshair.hidden = true
  svg.appendChild(crosshair)
  const spacing = rows.length > 1 ? plot.width / (rows.length - 1) : plot.width

  rows.forEach((row, index) => {
    const x = rows.length === 1 ? plot.left + plot.width / 2 : plot.left + index * spacing
    const hitWidth = Math.max(24, spacing)
    const hit = createTrendSvgElement("rect", {
      class: "trend-hit-target",
      x: Math.max(plot.left, x - hitWidth / 2),
      y: plot.top,
      width: Math.min(hitWidth, plot.right - Math.max(plot.left, x - hitWidth / 2)),
      height: plot.height,
      tabindex: 0,
      "aria-label": formatTrendDate(row.date, { year: true })
    })
    const show = () => {
      crosshair.hidden = false
      crosshair.setAttribute("x1", x)
      crosshair.setAttribute("x2", x)
      const values = series.map((item) => ({
        label: item.label,
        color: item.color,
        value: valueFormatter(trendValue(row[item.key]), item)
      }))
      showTrendTooltip(
        tooltip,
        formatTrendDate(row.date, { year: true }),
        [...values, ...(extraRows ? extraRows(row) : [])],
        { xRatio: x / size.width, yRatio: 0.32 }
      )
    }
    hit.addEventListener("pointerenter", show)
    hit.addEventListener("focus", show)
    hit.addEventListener("click", show)
    hit.addEventListener("pointerleave", () => hideTrendTooltip(tooltip, crosshair))
    hit.addEventListener("blur", () => hideTrendTooltip(tooltip, crosshair))
    svg.appendChild(hit)
  })
}

function renderTrendLineChart(containerId, rows, series, options = {}) {
  const hasValue = rows.some((row) => series.some((item) => trendValue(row[item.key]) !== null))
  if (!rows.length || !hasValue) {
    renderTrendEmpty(containerId, options.emptyMessage || "Log a few days to see trends here.")
    return
  }

  const size = { ...TREND_CHART_SIZE }
  const chart = createTrendChart(containerId, { label: options.label })
  const plot = getTrendPlot(size)
  const maxY = options.maxY || Math.max(1, ...rows.flatMap((row) => series.map((item) => trendValue(row[item.key]) || 0)))
  appendTrendAxes(chart.svg, size, maxY, options.yTicks || 5, rows, (row) => formatTrendDate(row.date))
  const spacing = rows.length > 1 ? plot.width / (rows.length - 1) : plot.width

  if (options.flareOverlay) {
    rows.forEach((row, index) => {
      if (!row.flareDay) return
      const x = rows.length === 1 ? plot.left + plot.width / 2 : plot.left + index * spacing
      chart.svg.appendChild(createTrendSvgElement("rect", {
        x: x - 5,
        y: plot.top,
        width: 10,
        height: plot.height,
        rx: 4,
        fill: "var(--trend-status-flare)",
        opacity: 0.13
      }))
    })
  }

  for (const item of series) {
    const points = rows.map((row, index) => {
      const value = trendValue(row[item.key])
      if (value === null) return null
      return {
        x: rows.length === 1 ? plot.left + plot.width / 2 : plot.left + index * spacing,
        y: plot.bottom - (value / maxY) * plot.height,
        value,
        row
      }
    }).filter(Boolean)
    if (!points.length) continue
    const path = createTrendSvgElement("path", {
      class: "trend-series-line",
      d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "),
      stroke: item.color
    })
    chart.svg.appendChild(path)
    for (const point of points) {
      chart.svg.appendChild(createTrendSvgElement("circle", {
        class: "trend-series-point",
        cx: point.x,
        cy: point.y,
        r: 4,
        fill: item.color
      }))
      if (options.flareOverlay && point.row.flareDay) {
        chart.svg.appendChild(createTrendSvgElement("circle", {
          cx: point.x,
          cy: point.y,
          r: 5,
          fill: "var(--trend-status-flare)",
          stroke: "var(--card-bg)",
          "stroke-width": 2
        }))
      }
    }
  }

  addTrendLineHover({
    svg: chart.svg,
    tooltip: chart.tooltip,
    rows,
    series,
    size,
    valueFormatter: options.valueFormatter || ((value) => value === null ? "Not logged" : String(value)),
    extraRows: options.flareOverlay
      ? (row) => row.flareDay ? [{ label: "Flare day", value: "Yes", color: "var(--trend-status-flare)" }] : []
      : null
  })
}

function roundedTopBarPath(x, y, width, bottom) {
  const radius = Math.min(4, width / 2, Math.max(0, (bottom - y) / 2))
  return `M ${x} ${bottom} V ${y + radius} Q ${x} ${y} ${x + radius} ${y} H ${x + width - radius} Q ${x + width} ${y} ${x + width} ${y + radius} V ${bottom} Z`
}

function addTrendBarHover(hit, tooltip, title, rows, position) {
  const show = () => showTrendTooltip(tooltip, title, rows, position)
  hit.addEventListener("pointerenter", show)
  hit.addEventListener("focus", show)
  hit.addEventListener("click", show)
  hit.addEventListener("pointerleave", () => hideTrendTooltip(tooltip))
  hit.addEventListener("blur", () => hideTrendTooltip(tooltip))
}

function renderWeeklyFlareChart(data) {
  if (!data.range.loggedDays) {
    renderTrendEmpty("trend-flare", "Log a few days to see trends here.")
    return
  }
  const rows = data.weeklyFlare || []
  const size = { ...TREND_CHART_SIZE }
  const chart = createTrendChart("trend-flare", { label: "Weekly flare-day count" })
  const plot = getTrendPlot(size)
  const maxY = Math.max(1, ...rows.map((row) => Number(row.count) || 0))
  appendTrendAxes(chart.svg, size, maxY, Math.min(7, maxY), rows, (row) => formatTrendDate(row.weekStart), true)
  const band = plot.width / Math.max(1, rows.length)
  const barWidth = Math.min(24, Math.max(6, band * 0.54))

  rows.forEach((row, index) => {
    const x = plot.left + index * band + (band - barWidth) / 2
    const count = Number(row.count) || 0
    const y = plot.bottom - (count / maxY) * plot.height
    if (count > 0) {
      chart.svg.appendChild(createTrendSvgElement("path", {
        d: roundedTopBarPath(x, y, barWidth, plot.bottom),
        fill: "var(--trend-series-1)",
        opacity: 0.38 + 0.57 * (count / maxY)
      }))
    }
    const hitWidth = Math.max(24, band)
    const hit = createTrendSvgElement("rect", {
      class: "trend-hit-target",
      x: plot.left + index * band + (band - hitWidth) / 2,
      y: plot.top,
      width: hitWidth,
      height: plot.height,
      tabindex: 0,
      "aria-label": `${count} flare days in week of ${formatTrendDate(row.weekStart, { year: true })}`
    })
    addTrendBarHover(hit, chart.tooltip, `Week of ${formatTrendDate(row.weekStart, { year: true })}`, [{
      label: "Flare days",
      value: String(count),
      color: "var(--trend-series-1)"
    }], { xRatio: (x + barWidth / 2) / size.width, yRatio: Math.max(0.2, y / size.height) })
    chart.svg.appendChild(hit)
  })
}

function formatTrendMinutes(value) {
  const duration = trendValue(value)
  if (duration === null) return "Not available"
  return `${Number.isInteger(duration) ? duration : duration.toFixed(1)} min`
}

function renderExertionBeforeFlareChart(data) {
  const comparison = data.exertionBeforeFlare || {}
  const rows = [
    {
      label: "Before flare days",
      axisLabel: "Before flare",
      ...(comparison.beforeFlareDays || {})
    },
    {
      label: "Before non-flare days",
      axisLabel: "Before non-flare",
      ...(comparison.beforeNonFlareDays || {})
    }
  ]

  if (rows.some((row) => (Number(row.count) || 0) < 3)) {
    renderTrendEmpty("trend-exertion", "Not enough data yet to compare exertion before flare vs. non-flare days.")
    return
  }

  const size = { ...TREND_CHART_SIZE }
  const chart = createTrendChart("trend-exertion", {
    label: "Average exercise duration before flare and non-flare days"
  })
  const plot = getTrendPlot(size)
  const observedMax = Math.max(0, ...rows.map((row) => trendValue(row.avgDuration) || 0))
  const maxY = Math.max(10, Math.ceil(observedMax / 10) * 10)
  appendTrendAxes(chart.svg, size, maxY, 5, rows, (row) => row.axisLabel, true)
  const band = plot.width / rows.length
  const barWidth = 24

  rows.forEach((row, index) => {
    const average = trendValue(row.avgDuration) || 0
    const count = Number(row.count) || 0
    const x = plot.left + index * band + (band - barWidth) / 2
    const y = plot.bottom - (average / maxY) * plot.height
    if (average > 0) {
      chart.svg.appendChild(createTrendSvgElement("path", {
        d: roundedTopBarPath(x, y, barWidth, plot.bottom),
        fill: "var(--trend-series-1)",
        opacity: 0.42 + 0.53 * (average / maxY)
      }))
    }

    const valueLabel = createTrendSvgElement("text", {
      class: "trend-value-label",
      x: x + barWidth / 2,
      y: Math.max(plot.top + 12, y - 8),
      "text-anchor": "middle"
    })
    valueLabel.textContent = formatTrendMinutes(average)
    chart.svg.appendChild(valueLabel)

    const hit = createTrendSvgElement("rect", {
      class: "trend-hit-target",
      x: plot.left + index * band,
      y: plot.top,
      width: band,
      height: plot.height,
      tabindex: 0,
      "aria-label": `${row.label}: ${formatTrendMinutes(average)} average across ${count} days`
    })
    addTrendBarHover(hit, chart.tooltip, row.label, [
      { label: "Average duration", value: formatTrendMinutes(average), color: "var(--trend-series-1)" },
      { label: "Days compared", value: String(count), color: "var(--trend-series-1)" }
    ], { xRatio: (x + barWidth / 2) / size.width, yRatio: Math.max(0.2, y / size.height) })
    chart.svg.appendChild(hit)
  })
}

function getSymptomTrendColor(key) {
  if (!trendsState.symptomColors.has(key)) {
    const slot = Math.min(12, trendsState.nextSymptomColor + 1)
    trendsState.symptomColors.set(key, `var(--trend-series-${slot})`)
    trendsState.nextSymptomColor += 1
  }
  return trendsState.symptomColors.get(key)
}

function renderSymptomFrequencyChart(data) {
  const target = document.getElementById("trend-symptoms-legend")
  const series = (data.symptomFrequency?.series || []).map((item) => ({
    ...item,
    label: item.name,
    color: getSymptomTrendColor(item.key)
  }))
  if (!data.range.loggedDays) {
    target?.replaceChildren()
    renderTrendEmpty("trend-symptoms", "Log a few days to see trends here.")
    return
  }
  if (!series.length) {
    target?.replaceChildren()
    renderTrendEmpty("trend-symptoms", "No symptoms logged in this range.")
    return
  }

  renderTrendLegend("trend-symptoms-legend", series)
  const weeks = data.symptomFrequency.weeks || []
  const width = Math.max(800, weeks.length * Math.max(58, series.length * 12 + 22))
  const size = { ...TREND_CHART_SIZE, width }
  const chart = createTrendChart("trend-symptoms", {
    width,
    pixelWidth: width,
    label: "Weekly symptom frequency"
  })
  const plot = getTrendPlot(size)
  const lookup = new Map(series.map((item) => [item.key, new Map(item.values.map((value) => [value.weekKey, Number(value.count) || 0]))]))
  const observedMax = Math.max(1, ...series.flatMap((item) => item.values.map((value) => Number(value.count) || 0)))
  const maxY = observedMax <= 6 ? observedMax : Math.ceil(observedMax / 5) * 5
  const yTicks = observedMax <= 6 ? observedMax : 5
  appendTrendAxes(chart.svg, size, maxY, yTicks, weeks, (week) => formatTrendDate(week.weekStart), true)
  const band = plot.width / Math.max(1, weeks.length)
  const gap = 2
  const groupWidth = Math.min(band - 8, series.length * 18 + (series.length - 1) * gap)
  const barWidth = Math.min(18, Math.max(4, (groupWidth - (series.length - 1) * gap) / series.length))
  const actualGroupWidth = series.length * barWidth + (series.length - 1) * gap

  weeks.forEach((week, weekIndex) => {
    const groupX = plot.left + weekIndex * band + (band - actualGroupWidth) / 2
    series.forEach((item, seriesIndex) => {
      const count = lookup.get(item.key).get(week.weekKey) || 0
      const x = groupX + seriesIndex * (barWidth + gap)
      const y = plot.bottom - (count / maxY) * plot.height
      if (count > 0) {
        chart.svg.appendChild(createTrendSvgElement("path", {
          d: roundedTopBarPath(x, y, barWidth, plot.bottom),
          fill: item.color
        }))
      }
      const hit = createTrendSvgElement("rect", {
        class: "trend-hit-target",
        x: x - Math.max(0, (24 - barWidth) / 2),
        y: Math.min(y, plot.bottom - 24),
        width: Math.max(24, barWidth),
        height: Math.max(24, plot.bottom - y),
        tabindex: 0,
        "aria-label": `${item.name}: ${count} in week of ${formatTrendDate(week.weekStart, { year: true })}`
      })
      addTrendBarHover(hit, chart.tooltip, `Week of ${formatTrendDate(week.weekStart, { year: true })}`, [{
        label: item.name,
        value: String(count),
        color: item.color
      }], { xRatio: (x + barWidth / 2) / width, yRatio: Math.max(0.2, y / size.height) })
      chart.svg.appendChild(hit)
    })
  })
}

function renderTrendsPage() {
  const data = trendsState.data
  if (!data) return
  const sleepRows = data.sleep || []
  renderTrendLineChart("trend-sleep", sleepRows, [{
    key: "hours",
    label: "Sleep hours",
    color: "var(--trend-series-1)"
  }], {
    label: "Nightly sleep hours with flare days marked",
    maxY: Math.ceil(Math.max(10, ...sleepRows.map((row) => trendValue(row.hours) || 0))),
    yTicks: 5,
    flareOverlay: true,
    emptyMessage: data.range.loggedDays ? "No sleep hours logged in this range." : "Log a few days to see trends here.",
    valueFormatter: (value) => value === null ? "Not logged" : `${value} hr`
  })
  renderWeeklyFlareChart(data)
  renderExertionBeforeFlareChart(data)
  renderTrendLegend("trend-scores-legend", TREND_SCORE_SERIES)
  renderTrendLineChart("trend-scores", data.scores || [], TREND_SCORE_SERIES, {
    label: "Mood, average energy, and stress ratings",
    maxY: 10,
    yTicks: 5,
    emptyMessage: data.range.loggedDays ? "No mood, energy, or stress ratings logged in this range." : "Log a few days to see trends here.",
    valueFormatter: (value) => value === null ? "Not logged" : `${value}/10`
  })
  renderSymptomFrequencyChart(data)
}

async function loadTrends(days = trendsState.days) {
  const status = document.getElementById("trends-status")
  const buttons = [...document.querySelectorAll("[data-trends-days]")]
  trendsState.days = String(days)
  buttons.forEach((button) => {
    button.disabled = true
    button.classList.toggle("is-active", button.dataset.trendsDays === trendsState.days)
  })
  if (status) status.textContent = "Loading trends…"

  try {
    trendsState.data = await fetchJson(`/api/trends?days=${encodeURIComponent(trendsState.days)}`)
    const range = trendsState.data.range
    const label = trendsState.days === "all"
      ? "All logged history"
      : `Last ${trendsState.days} days`
    document.getElementById("trends-range-label").textContent = `${label} · ${formatTrendDate(range.startDate, { year: true })} to ${formatTrendDate(range.endDate, { year: true })}`
    if (status) status.textContent = range.loggedDays
      ? `${range.loggedDays} logged ${range.loggedDays === 1 ? "day" : "days"} in this range.`
      : "No logged days in this range yet."
    renderTrendsPage()
  } catch (error) {
    if (status) status.textContent = error.message || "Trends could not be loaded."
    ;["trend-sleep", "trend-flare", "trend-exertion", "trend-scores", "trend-symptoms"].forEach((id) => {
      renderTrendEmpty(id, "Trends could not be loaded.")
    })
  } finally {
    buttons.forEach((button) => { button.disabled = false })
  }
}

async function setupTrendsPage() {
  await setupShellPage()
  document.querySelectorAll("[data-trends-days]").forEach((button) => {
    button.addEventListener("click", () => loadTrends(button.dataset.trendsDays))
  })
  await loadTrends("90")
}

async function bootstrap() {
  const page = document.body.dataset.page

  if (page === "dashboard") {
    await setupDashboard()
  }

  if (page === "onboarding") {
    await setupOnboarding()
  }

  if (page === "chat") {
    await setupChat()
  }

  if (page === "notes") {
    await setupNotesPage()
  }

  if (page === "records") {
    await setupRecordsPage()
  }

  if (page === "schedules") {
    await setupSchedulesPage()
  }

  if (page === "dev-logs") {
    await setupDevLogsPage()
  }

  if (page === "automations") {
    await setupAutomationsPage()
  }

  if (page === "trends") {
    await setupTrendsPage()
  }

  if (page !== "onboarding") {
    await initPageTour(page, getPageTourSteps()).catch((error) => {
      console.error("[Boris Tour] Unable to initialize", error)
    })
  }

}

bootstrap().catch((error) => {
  console.error("[Boris UI] Bootstrap failed", error)
})
