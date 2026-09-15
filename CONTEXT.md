# Boris architecture notes

This document describes the current implementation for reviewers and future maintenance. Boris is a single-user personal health agent, not a multi-tenant service.

## System shape

The project has no frontend build step or framework:

```text
server.js                  Express routes, orchestration, startup
core/
  api.js                   OpenAI client and request-level observability
  automations.js           reminder/brief normalization and execution
  chat.js                  intent classification and shared chat routing
  db.js                    local active-user configuration
  extractor.js             lab, supplement, and doctor-note extraction
  google.js                Google OAuth and read-only Calendar sync
  neon.js                  schema initialization and Postgres queries
  parser.js                structured natural-language health logging
  pricing.js               model cost estimates
  profile.js               Identity, Health Picture, onboarding memory
  scheduler.js             summaries, health-picture refresh, cron jobs
  schedules.js             recurring blocks and planning preferences
  telegram.js              Telegram long polling and delivery
  time.js                  application-timezone helpers
  trends.js                generic longitudinal chart aggregation
  utils.js                 shared small utilities
  weather.js               OpenWeather fetch and daily cache
ui/
  *.html                   product pages and page-specific tutorial data
  assets/app.js            all browser behavior
  assets/style.css         shared visual system and responsive layout
scripts/
  seed-demo-data.js        guarded fictional portfolio dataset
test/                      Node test suite
```

The frontend calls same-origin JSON and text endpoints. `server.js` coordinates the domain modules and serves static assets. Runtime state is persisted in Postgres except for short-lived browser state, Telegram conversation buffers, and the local `config.json` user selector.

## Startup

`startServer()` performs these steps:

1. Load environment variables and the active user ID.
2. Run `initSchema()` against `DATABASE_URL`.
3. Initialize the OpenAI client when a key is configured.
4. Start Express.
5. Register summary and automation cron jobs.
6. Start Telegram polling when Telegram configuration exists.

Schema changes are idempotent SQL statements in `core/neon.js`. This keeps installation simple, although a versioned migration system would be safer for a larger production deployment.

## Data model

The current schema contains 19 tables:

- `daily_logs`: daily structured health state and freeform entries
- `lab_results`: source metadata and extracted lab values
- `prescriptions`: medication records and active status
- `supplements`: supplement records and active status
- `supplement_ingredients`: normalized ingredient rows
- `doctor_visits`: source text, editable summaries, warnings, provider metadata
- `google_connections`: OAuth connection and selected-calendar settings
- `calendar_events`: read-only synchronized events
- `recurring_schedules`: Boris-native weekly blocks
- `planning_preferences`: scheduling and recovery preferences
- `automations`: reminders and morning briefs
- `automation_runs`: idempotent delivery attempts and outcomes
- `visited_pages`: first-visit tutorial progress
- `memory_files`: Identity, Health Picture, and onboarding snapshot
- `memory_file_archives`: prior generated memory versions
- `user_lists`: user-defined tracking lists such as symptoms
- `summaries`: daily through yearly generated summaries
- `threads`: dated conversation history
- `ai_request_logs`: request content, token use, cost, latency, and status

All records are scoped by the active `user_id`. This is data separation for one trusted installation, not an authorization boundary.

## Profile and memory lifecycle

Onboarding writes three distinct memory artifacts:

- **Identity:** stable profile facts, goals, and communication preferences.
- **Onboarding snapshot:** the original source information used to establish context.
- **Health Picture:** a generated, current clinical-style snapshot of treatments, patterns, labs, and concerns.

Identity can be edited or updated explicitly. It is not regenerated on the summary schedule. Health Picture is expected to evolve: it is regenerated after onboarding, on the weekly summary schedule, manually from Doctor's Notes, and after relevant medical-record changes. Active prescriptions and supplements in their structured tables are the source of truth for its treatment section.

## Chat and context planning

Browser and Telegram messages enter the same `processChatMessage()` pipeline. Classification separates several behaviors:

- health logging
- a health question for Doctor Mode
- an update to Identity or profile memory
- a product/meta question
- a daily-recap answer
- an automation request

Doctor Mode does not load the full database for every response. Its context plan starts with current profile memory, recent logs, current treatment records, relevant labs and visits, and recent summaries. Historical language in the question enables progressively broader weekly, monthly, or quarterly context.

Every OpenAI call goes through `core/api.js`, which records source, label, model, token counts, estimated cost, latency, output, and failure details in `ai_request_logs`.

## Daily logging

Daily logs use a JSON-oriented record because the dashboard evolves more quickly than normalized clinical records. A log can include:

- sleep, energy, mood, stress, good-day status, HRV, and resting heart rate
- timestamped blood pressure, temperature, and weight readings
- medication and supplement completion
- user-defined symptoms and occurrence times
- meals and estimated macros
- caffeine, alcohol, water, exercise, and flare-day status
- notes about changes plus timestamped journal entries
- cached weather context

Symptoms are defined in `user_lists`, then copied into each day's state with explicit logged/present semantics. Prescriptions and supplements use dedicated tables because they have independent lifecycle, source, dose, frequency, and active-state requirements.

## Medical records

Supported record types are labs, doctor visits, prescriptions, and supplements.

1. A user uploads a supported file or enters text/manual details.
2. Extraction returns structured data and warnings.
3. The UI presents editable fields before persistence.
4. The reviewed record is saved to its dedicated table.
5. Relevant record changes trigger a Health Picture refresh.

Doctor-note extraction preserves distinctions between suspected and confirmed diagnoses, recommendations and completed actions, ordered and completed tests, and formal versus suggested referrals. Patient-name and visit-date mismatches appear as review warnings rather than being silently discarded.

Lab extraction retains units, reference ranges, flags, and interpretation text. Saved lab changes rebuild the lab section of the Health Picture from structured records.

## Schedules and automations

Recurring schedules are Boris-native weekly blocks with category, time, location, drain level, flexibility, notes, and active state. Planning preferences provide context for schedule-aware responses. Google Calendar sync is read-only and uses calendar names and colors from the connected account rather than fixed calendar labels.

Automations support:

- one-time delivery
- several explicit date/time occurrences
- recurring weekday/time schedules with optional date bounds
- static reminders
- generated morning briefs

The automation runner claims due work through persisted next-run state and records attempts in `automation_runs`. Briefs and Telegram delivery require the Node process to remain running. Onboarding creates a default daily 9:00 AM morning brief.

## Summaries

The scheduler builds a hierarchy:

```text
daily logs -> daily summaries -> weekly -> monthly -> quarterly -> yearly
```

Period helpers use explicit calendar boundaries. Higher-level summaries consume only lower-level summaries and logs inside their target period. Weekly generation also refreshes Health Picture. Manual summary edits are retained as edited records.

## Trends

`GET /api/trends?days=90` loads the selected daily-log range and returns chart-ready data. Supported presets are 7, 30, 90 days, and all time.

`core/trends.js` calculates:

- nightly sleep with flare-day state
- weekly flare counts using the summary system's ISO week boundaries
- mood, average daily energy, and stress
- dynamic weekly symptom frequency with the top five plus `Other`
- average and median prior-day exercise duration before flare and non-flare days

No symptom, diagnosis, exercise type, medication, or persona name is assumed by the aggregation. Missing scalar values are skipped; a prior day with no exercise contributes zero minutes to the exertion comparison.

The browser renders dependency-free inline SVG with one y-scale per chart, fixed entity colors, accessible hover/focus targets, and sparse-data states.

## Demo data

`npm run seed:demo` requires the active user ID to equal `portfolio-demo`. It clears only that user's rows, then creates 120 dated logs, structured treatments, summaries, schedules, preferences, a morning brief, chat history, and one synthetic API log.

The fictional scenario models gradual post-viral recovery with overlapping sleep, exertion, hydration, stress, and treatment changes. It is intentionally noisy enough for Doctor Mode and Trends to discuss associations without claiming deterministic causation.

## Security boundary

The repository excludes `.env`, `config.json`, dependencies, uploads, exports, local tooling, and temporary logs. Markdown is escaped before rendering through `marked`; its link and image renderers allow only HTTP, HTTPS, mailto, and same-origin relative URLs. Protocol-relative URLs, backslashes, and embedded control characters are rejected. User-controlled HTML interpolations use escaping helpers. Request bodies and uploads have explicit size and part limits. Basic response headers disable MIME sniffing, framing, referrer leakage, and the Express signature.

The application still has deliberate single-user limits:

- no browser authentication or authorization
- no CSRF protection
- no public rate limiting
- no multi-tenant access model
- sensitive OpenAI prompts and outputs retained in request logs
- OAuth tokens and health data stored in the configured Postgres database

The server should remain local or sit behind an authenticated private access layer. A public interactive demo needs a separate read-only or disposable-data mode plus authentication and rate/cost controls.

## Known engineering tradeoffs

- `server.js`, `ui/assets/app.js`, and `ui/assets/style.css` are intentionally monolithic. Splitting route groups and frontend page modules would improve maintainability but is not required for the current portfolio scope.
- Startup SQL favors zero-setup installation over versioned migrations.
- Cron and Telegram polling are process-local, so production operation requires one persistent worker or an external job architecture.
- AI extraction and summaries remain probabilistic. The editable review step and source preservation are part of the correctness model.
- Automated tests emphasize domain transforms and failure handling. Full browser end-to-end and live-provider integration tests are not included.

## Verification

`npm test` runs the Node test suite. GitHub Actions installs from `package-lock.json` and executes the same command on pushes and pull requests. Dependency vulnerabilities can be checked with `npm audit --omit=dev`.
