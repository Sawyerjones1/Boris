const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { once } = require("node:events");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const { test } = require("node:test");

async function startTestDatabase(t) {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boris-concurrency-test-"));
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(directory, "data"), port,
    user: "test", password: "disposable-test-password", persistent: true,
    postgresFlags: ["-h", "127.0.0.1", "-c", "fsync=off", "-c", "unix_socket_directories="],
    onLog() {}, onError() {}
  });
  let db;
  t.after(async () => {
    if (db) await db.pool.end();
    await cluster.stop();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith("boris-concurrency-test-"));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await cluster.initialise();
  await cluster.start();

  const filename = require.resolve("../core/neon");
  const realRequire = createRequire(filename);
  const context = vm.createContext({
    module: { exports: {} }, URL, console: { log() {}, error() {} },
    process: { env: { DATABASE_URL: `postgresql://test:disposable-test-password@127.0.0.1:${port}/postgres` } },
    require: (name) => name === "dotenv" ? { config() {} } : realRequire(name)
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  db = context.module.exports;
  await db.initSchema();
  return db;
}

test("daily log writes preserve concurrent changes in real PostgreSQL", { timeout: 30000 }, async (t) => {
  const db = await startTestDatabase(t);
  // Delay actual database writes so the old read/merge/write implementation
  // reliably reads the same baseline from two separate sessions.
  await db.pool.query(`
    CREATE TABLE write_sessions (pid INTEGER);
    CREATE FUNCTION slow_test_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO write_sessions VALUES (pg_backend_pid());
      PERFORM pg_sleep(0.05);
      RETURN NEW;
    END $$;
    CREATE TRIGGER slow_test_write BEFORE INSERT OR UPDATE ON daily_logs
      FOR EACH ROW EXECUTE FUNCTION slow_test_write();
  `);

  for (const existing of [true, false]) {
    await t.test(`concurrent patches survive for an ${existing ? "existing" : "initially missing"} daily log`, async () => {
      const userId = existing ? "existing-user" : "new-user";
      const date = "2026-09-15";
      if (existing) await db.updateLog(userId, date, { vitals: { sleep: { quality: 6 } }, journal: "Keep this note" });
      await db.pool.query("TRUNCATE write_sessions");

      await Promise.all([
        db.updateLog(userId, date, { vitals: { mood: 8 } }),
        db.updateLog(userId, date, { vitals: { sleep: { hours: 7 } }, intake: { water: "good" } })
      ]);

      const saved = await db.getLog(userId, date);
      assert.equal(saved.vitals.mood, 8);
      assert.equal(saved.vitals.sleep.hours, 7);
      assert.equal(saved.intake.water, "good");
      if (existing) {
        assert.equal(saved.vitals.sleep.quality, 6);
        assert.equal(saved.journal, "Keep this note");
      }
      const sessions = await db.pool.query("SELECT COUNT(DISTINCT pid)::int AS count FROM write_sessions");
      assert.ok(sessions.rows[0].count >= 2, "updates must execute on separate database connections");
    });
  }

  await t.test("patches still replace arrays and allow explicit field clearing", async () => {
    await db.updateLog("clear-user", "2026-09-15", { supplements: [{ name: "Example" }], whatChanged: "Temporary note" });
    await db.updateLog("clear-user", "2026-09-15", { supplements: [], whatChanged: null });
    const saved = await db.getLog("clear-user", "2026-09-15");
    assert.equal(saved.supplements.length, 0);
    assert.equal(saved.whatChanged, null);
  });

  await t.test("a failed first write rolls back creation and releases its lock", async () => {
    const circular = {};
    circular.self = circular;
    await assert.rejects(db.updateLog("failed-user", "2026-09-15", { weather: circular }), /circular/i);
    assert.equal(await db.getLog("failed-user", "2026-09-15"), null);
    await db.updateLog("failed-user", "2026-09-15", { vitals: { mood: 5 } });
    assert.equal((await db.getLog("failed-user", "2026-09-15")).vitals.mood, 5);
  });
});
