// Tests that import domain modules need configuration, but must never inherit
// the real database or provider credentials from the shell or a local .env.
// Integration tests construct their own disposable PostgreSQL connection.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/boris_test";
for (const key of [
  "OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN", "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET", "OPENWEATHERMAP_API_KEY"
]) {
  process.env[key] = "";
}
