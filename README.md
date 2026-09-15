# Boris

[![CI](https://github.com/Sawyerjones1/Boris/actions/workflows/ci.yml/badge.svg)](https://github.com/Sawyerjones1/Boris/actions/workflows/ci.yml)

Boris is a single-user personal health agent that combines structured daily tracking, medical-record extraction, longitudinal summaries, and an AI chat interface. The same data and reasoning path power both the browser UI and an optional Telegram bot.

The project is designed to answer questions that a single long chat thread handles poorly: What changed before difficult days? Is a symptom becoming more frequent? Did a new routine coincide with a meaningful shift? Boris keeps the underlying data structured, compresses older history into summaries, and loads only the context needed for each response.

> Boris is a personal tracking and software demonstration project. It is not a medical device and does not diagnose conditions or replace professional medical advice.

[View the slideshow preview](https://sawyerjones.me/project-boris#preview) · [Try the demo](#try-the-demo) · [Engineering highlights](#engineering-highlights) · [Tests](#tests)

![Daily dashboard with vitals, supplements, symptoms, meals, and exercise for a single day](docs/images/dashboard.png)

*One day of structured tracking. Every field autosaves and the whole page is scoped by date.*

## Try the demo

Explore Boris with 120 days of fictional health data. You can browse the dashboard, edit daily logs, inspect trends, and read seeded conversations and summaries **without an OpenAI key**. Live AI features and integrations can be enabled afterward.

### 1. Install the prerequisites

- **Git** to clone the repository.
- **[Node.js 24 LTS](https://nodejs.org/en/download)**, including npm. Check your installation with `node --version` and `npm --version`.
- **A separate Postgres database for the demo.** Boris was developed with Neon; an existing local Postgres 14+ database also works.

For a hosted database, create a project in [Neon](https://neon.com/docs/get-started/signing-up). Open **Connect** on the project dashboard, select the database and its owner role, and copy the Postgres connection URL. Copy the URL itself, without a surrounding `psql` command. See [Neon's connection guide](https://neon.com/docs/connect/connect-from-any-app).

The database must already exist, and the connection role must be able to create and update tables in it. Boris creates its tables automatically during seeding or startup; there is no separate migration command or frontend build step.

### 2. Clone and configure

```bash
git clone https://github.com/Sawyerjones1/Boris.git
cd Boris
npm ci
```

Copy the configuration templates:

**macOS / Linux**

```bash
cp .env.example .env
cp config.json.example config.json
```

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
Copy-Item config.json.example config.json
```

If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm` for every command in this guide.

Set `config.json` to:

```json
{
  "userId": "portfolio-demo"
}
```

In `.env`, replace `DATABASE_URL` with your database's connection URL and choose your timezone:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=verify-full
APP_TIMEZONE=America/New_York
OPENAI_API_KEY=
```

The URL above is a placeholder; use the actual value from your provider. For local Postgres, a typical URL is `postgresql://user:password@127.0.0.1:5432/boris`. See [database connection options](#database-connection-options) for TLS behavior.

`APP_TIMEZONE` uses an IANA timezone such as `America/Chicago` or `Europe/London` and controls server dates and default scheduling. Set it before seeding or onboarding. Leave the optional integration keys blank for this walkthrough.

### 3. Seed and start

```bash
npm run seed:demo
npm start
```

Wait for the terminal to print `Server listening on http://127.0.0.1:3000`, then open **[http://localhost:3000](http://localhost:3000)**. The seeded profile opens directly to the dashboard; onboarding is already complete. Keep the terminal running and use `Ctrl+C` to stop Boris.

The seed ends on the current UTC date by default. For fixed screenshots, set `DEMO_END_DATE=YYYY-MM-DD` in `.env` before seeding. If the dashboard's current day falls outside the seeded range, use its date picker to open the seed's final date.

### 4. Explore the project

- **Dashboard:** Open a populated day, change a value, then refresh to verify it persisted.
- **Trends:** Switch to the 90-day or all-time range to explore sleep, flares, and symptom frequency.
- **Doctor's Notes:** Inspect the profile memory and summaries at different time scales.
- **Chat and API logs:** Browse the seeded examples. Add an AI key to send a new message or inspect a real model request.

The fictional persona, Jordan Reyes, has a post-viral recovery history with changes in sleep, exercise, symptoms, and medication. Seeded conversations, summaries, and API-log examples are synthetic. Lab results and doctor visits start empty so you can try extraction with your own synthetic documents.

### Enable AI features

Set `OPENAI_API_KEY` in `.env` and restart Boris to enable live chat, natural-language logging, macro estimation, document extraction, and newly generated summaries. These features make requests to the OpenAI API. Existing seeded data and manual tracking remain available without the key.

Telegram, Google Calendar, and weather have separate credentials; see [optional integrations](#optional-integrations). The seeded 9:00 AM morning brief needs both AI and Telegram configuration to generate and deliver a message.

### Reset the demo

Stop Boris before reseeding or resetting. **`npm run seed:demo` replaces all records for `portfolio-demo`, including edits made while exploring.** It refuses to run under any other configured user ID.

To delete the fictional user's records without reseeding:

```bash
npm run reset:demo
```

Run `npm start` afterward to begin onboarding with an empty profile.

## Start with your own profile

Follow the installation and configuration steps above, using a separate database and a `config.json` user ID such as `local-user`. Skip the demo seed, run `npm start`, and complete onboarding at [http://localhost:3000](http://localhost:3000).

An OpenAI key enables AI-generated onboarding synthesis. Without one, Boris saves a structured onboarding summary and still supports manual tracking. Optional integrations can be added later.

## Product tour

![Chat thread showing plain-language logging, a data-grounded answer, and a reminder being scheduled](docs/images/chat.png)

*The same thread logs data, answers questions from your own history, and schedules reminders.*

- **Daily dashboard:** Track sleep, energy, mood, stress, vitals, medications, supplements, symptoms, meals, hydration, exercise, flare days, and journal notes.
- **Boris chat:** Log information in plain language, ask questions in Doctor Mode, update profile memory, and create reminders conversationally.
- **Medical records:** Extract lab values from PDFs, summarize doctor notes from PDFs or pasted text, scan supplement labels, and maintain active prescriptions and supplements. Extracted data is editable before saving.
- **Schedules:** Model recurring work, exercise, appointments, and recovery blocks. Optionally display read-only Google Calendar events alongside them.
- **Automations:** Schedule one-time, multiple, or recurring Telegram reminders and health-aware morning briefs. Onboarding creates a default 9:00 AM morning brief.
- **Trends:** Explore sleep, weekly flares, mood/energy/stress, symptom frequency, and prior-day exertion across 7, 30, 90-day, or all-time ranges.
- **Doctor's Notes:** Review and edit Identity and Health Picture memory plus daily, weekly, monthly, quarterly, and yearly summaries.
- **API logs:** Inspect model inputs, outputs, token usage, latency, estimated cost, and failures with filtering, pagination, and CSV export.

Each main page includes a first-visit tutorial. Tutorial progress is stored per user in Postgres.

![Trends page showing sleep, flare days, mood and energy, exertion, and symptom frequency charts](docs/images/trends.png)

*Trends are generated from whatever you have actually logged. The symptom chart discovers its own categories at runtime rather than using a fixed list.*

## Engineering highlights

- **Shared intent pipeline:** Web and Telegram messages use the same classifier and routing logic for logging, questions, profile updates, recap answers, and automation requests.
- **Tiered context loading:** Current questions use recent structured data; historical questions selectively add weekly, monthly, and quarterly summaries.
- **Hierarchical memory:** Scheduled jobs compress daily data into progressively larger summary periods and regenerate the current Health Picture from dated evidence.
- **Review before write:** Medical extraction produces an editable review step before structured records enter the database.
- **Observable AI calls:** OpenAI requests pass through one wrapper that records usage, cost, latency, source, and outcome.
- **Generic trend aggregation:** Charts discover user-defined symptoms at runtime and use the existing daily-log schema without persona-specific assumptions.
- **Deterministic demo:** A guarded seed script creates 120 days of fictional, internally consistent health data for portfolio demonstrations.

![API logs showing token usage, latency, and cost per request](docs/images/logs.png)

*Every model call is recorded with its prompt, token counts, latency, and estimated cost.*

```mermaid
flowchart LR
    Web[Browser UI] --> API[Express server]
    Telegram[Telegram bot] --> Chat[Shared chat router]
    API --> Chat
    API --> Records[Record extraction and review]
    API --> Trends[Trend aggregation]
    Chat --> Context[Context planner]
    Context --> OpenAI[OpenAI API]
    Records --> OpenAI
    Scheduler[Summary and automation scheduler] --> OpenAI
    API --> Postgres[(Postgres)]
    Chat --> Postgres
    Records --> Postgres
    Trends --> Postgres
    Scheduler --> Postgres
```

## Stack

| Area | Technology |
| --- | --- |
| Backend | Node.js, Express 5 |
| Frontend | Plain HTML, CSS, JavaScript, and inline SVG charts |
| Database | Postgres, developed with Neon |
| AI | OpenAI API |
| Documents | `pdf-parse`, image inputs, structured extraction prompts |
| Scheduling | `node-cron` |
| Optional integrations | Telegram, Google Calendar, OpenWeather |
| Testing | Node's built-in test runner, GitHub Actions |

## Database connection options

- **Local Postgres:** Loopback hosts (`localhost`, `127.x.x.x`, `::1`) and Unix sockets default to non-TLS connections. `?sslmode=disable` is also accepted locally.
- **Hosted Postgres:** Remote connections verify the certificate chain and hostname. Use `sslmode=verify-full`; provider URLs using `require`, `prefer`, or `verify-ca` are upgraded to full verification.
- **Custom certificates:** Supply `sslrootcert` in the URL with the path to the CA certificate. Client certificate options `sslcert` and `sslkey` are also supported. Explicit TLS options enable verified TLS even on localhost.
- **Configuration precedence:** Conflicting SSL options, unverified modes, and non-TLS remote connections are rejected. Boris derives its TLS policy from `DATABASE_URL`; `PGSSLMODE` does not override it.

## Optional integrations

### Telegram

1. Create a bot through [BotFather](https://t.me/BotFather). Set `TELEGRAM_BOT_TOKEN` in `.env`, leaving `TELEGRAM_ALLOWED_CHAT_ID` blank initially.
2. Start Boris. After the terminal reports `Polling started`, send a new private message to your bot. Boris logs `Detected private chat` with a numeric `chatId`; it does not reply until that ID is allowed.
3. Copy that number into `TELEGRAM_ALLOWED_CHAT_ID` in `.env` and restart Boris.
4. Send a new `/start` or `/id` message. The bot should now reply and confirm the connection.

The process must remain running for polling, reminders, and briefs to work. Existing messages may be skipped on startup, so send a fresh message when checking the connection.

Two optional overrides are also recognized. `TELEGRAM_CHAT_ID` acts as a fallback when `TELEGRAM_ALLOWED_CHAT_ID` is not set, and `TELEGRAM_USER_ID` routes inbound Telegram messages to a specific user ID instead of the one in `config.json`. Neither is needed for a standard single-user setup.

![A scheduled morning brief delivered over Telegram](docs/images/morning-brief-telegram.png)

*Once connected, scheduled briefs and reminders arrive over Telegram, and messages sent back to the bot are logged through the same pipeline as the web UI.*

### Google Calendar

Enable the Google Calendar API, create a Web application OAuth client, and add `http://localhost:3000/auth/google/callback` as an authorized redirect URI. Then set:

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

Restart Boris, open **Schedules**, and select **Connect Google** to authorize access. If you use a different port, update the redirect URI in both Google and `.env`.

Calendar access is read-only. Boris stores the connection in Postgres and displays selected calendars alongside recurring blocks.

### Weather

Set an OpenWeather API key and coordinates to enable the dashboard weather card:

```dotenv
OPENWEATHERMAP_API_KEY=
WEATHER_LAT=
WEATHER_LON=
WEATHER_UNITS=imperial
```

## Tests

After `npm ci`, run:

```bash
npm test
```

The test suite covers concurrent database updates, dashboard autosave races, Markdown URL safety, database TLS configuration, demo checklists, scheduling, automations, medical-record normalization, profile generation, API logging, tutorials, and trend aggregation. GitHub Actions runs the suite on pushes to `main` and on pull requests.

`npm test` uses isolated test configuration and needs no `.env` or provider credentials. Concurrency tests start a real, temporary PostgreSQL 17 instance bound to loopback, exercise separate database connections, then stop it and remove its temporary data. The development-only `embedded-postgres` dependency installs the platform binaries through npm; no Docker or existing database is required. Run tests as a normal user (Postgres refuses to run as root).

## Troubleshooting

After changing `.env`, stop and restart Boris so it loads the new values.

| Symptom | What to check |
| --- | --- |
| `npm.ps1 cannot be loaded` in PowerShell | Use `npm.cmd ci`, `npm.cmd start`, or `npm.cmd test`. No execution-policy change is needed. |
| `EBADENGINE` or PDF dependency errors | Check `node --version`, install Node.js 24 LTS, then rerun `npm ci`. The PDF dependency requires `>=20.16.0 <21` or `>=22.3.0`. |
| Missing `DATABASE_URL` or schema initialization fails | Check that `.env` is in the repository root, the database exists, and the URL contains the correct host, database, and credentials. The role needs permission to create and update tables. |
| Certificate verification fails | Use the provider's connection URL and, when required, its CA certificate via `sslrootcert`. Check the hostname and certificate configuration. |
| `EADDRINUSE` / port 3000 is occupied | Set `PORT=3001` in `.env`, restart, and open `http://localhost:3001`. Update the Google redirect URI if that integration is enabled. |
| Onboarding appears after seeding | Confirm `config.json` uses `portfolio-demo`, the seed completed successfully, and the seed and server use the same database. |
| AI features are unavailable or a request fails | Check `OPENAI_API_KEY` and the error in the terminal or API logs. A blank key leaves AI features disabled; the seeded dashboard still works. |
| Telegram is silent | Follow the chat-ID setup above, restart after saving it, and send a new private message while Boris is running. |

## Privacy and deployment

Boris intentionally targets one trusted user. The browser application and REST API do not include account authentication, authorization, CSRF protection, or multi-tenant isolation. Anyone who can reach the server can read and modify the configured user's data.

- Keep `.env` and `config.json` local; both are gitignored.
- Use a separate database for fictional demo data.
- Do not expose the Node server directly to the public internet.
- Boris binds to `127.0.0.1` by default. For deliberate remote access, set `HOST` to a specific interface or `0.0.0.0` (all IPv4 interfaces) in `.env`. This does not add authentication; use an authenticated private access layer. Startup prints the actual bound address and port.
- If hosting it remotely, put it behind access control such as a private network or authenticated reverse proxy.
- OpenAI request logs can contain health information because prompts and outputs are retained for observability. Use the truncation control on the Logs page when appropriate.
- Google credentials, Telegram credentials, and database credentials belong in environment variables, never tracked files.

For implementation details and known tradeoffs, see [CONTEXT.md](CONTEXT.md).

## License

No open-source license has been selected. The code is currently published for portfolio review with all rights reserved.
