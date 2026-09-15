const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const { test } = require("node:test");

function loadServer(host) {
  const filename = path.join(__dirname, "../server.js");
  const realRequire = createRequire(filename);
  const logs = [];
  let schemaCalls = 0;
  const mocks = {
    "dotenv": { config() {} },
    "./core/neon": { initSchema: async () => { schemaCalls += 1; } },
    "./core/api": { getOpenAIClient: () => null },
    "./core/scheduler": { initScheduler() {} },
    "./core/automations": { startAutomationRunner() {} },
    "./core/telegram": { startTelegramPolling() {} }
  };
  const context = vm.createContext({
    __filename: filename, __dirname: path.dirname(filename),
    module: { exports: {} },
    process: { env: { PORT: "0", ...(host === undefined ? {} : { HOST: host }) } },
    console: { log: (...args) => logs.push(args.join(" ")), error() {} },
    require: (name) => mocks[name] || (name.startsWith("./core/") ? {} : realRequire(name))
  });
  // Actual Express app and TCP listener; only providers and background jobs are stubbed.
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { ...context.module.exports, logs, get schemaCalls() { return schemaCalls; } };
}

for (const [host, expected] of [[undefined, "127.0.0.1"], ["  ", "127.0.0.1"], ["0.0.0.0", "0.0.0.0"]]) {
  test(`server binds to ${expected} with HOST=${JSON.stringify(host)}`, async (t) => {
    const loaded = loadServer(host);
    assert.equal(loaded.schemaCalls, 0, "importing the server must not start it");
    const server = await loaded.startServer();
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const address = server.address();
    assert.equal(address.address, expected);
    assert.ok(address.port > 0);
    assert.equal(loaded.schemaCalls, 1);
    assert.ok(loaded.logs.includes(`[Boris] Server listening on http://${expected}:${address.port}`));

    const response = await fetch(`http://127.0.0.1:${address.port}/assets/style.css`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.ok((await response.text()).length > 0);
  });
}
