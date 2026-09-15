const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const net = require("node:net");
const { once } = require("node:events");
const { Client } = require("pg");
const { test } = require("node:test");

const filename = require.resolve("../core/neon");
const realRequire = createRequire(filename);
const context = vm.createContext({
  module: { exports: {} }, URL, console,
  process: { env: { DATABASE_URL: "postgresql://test:test@localhost/test" } },
  require: (name) => name === "dotenv" ? { config() {} } : realRequire(name)
});
vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
const { buildDatabaseConfig } = context.module.exports;

function parameters(url) {
  return new Client(buildDatabaseConfig(url)).connectionParameters;
}

for (const host of ["localhost", "127.0.0.1", "127.0.0.2", "[::1]"]) {
  test(`local ${host} defaults to non-TLS and honors an explicit disable`, () => {
    for (const suffix of ["", "?sslmode=disable", "?ssl=false", "?ssl=0"]) {
      assert.equal(parameters(`postgresql://test:test@${host}/test${suffix}`).ssl, false);
    }
  });
}

for (const options of ["", "sslmode=verify-full", "sslmode=require", "sslmode=prefer", "sslmode=verify-ca", "ssl=true", "sslmode=require&uselibpqcompat=true"]) {
  test(`remote TLS verifies certificates and hostnames (${options || "default"})`, () => {
    const config = buildDatabaseConfig(`postgresql://test:test@db.example.com/test?${options}`);
    const effective = new Client(config).connectionParameters;
    assert.equal(config.connectionString, undefined);
    assert.equal(effective.ssl.rejectUnauthorized, true);
    assert.equal(effective.ssl.checkServerIdentity, undefined, "use Node's hostname verification");
  });
}

test("explicit TLS works locally and host query parameters cannot bypass remote policy", () => {
  assert.equal(parameters("postgresql://test:test@[::1]/test").host, "::1");
  assert.equal(parameters("postgresql://test:test@localhost/test?sslmode=verify-full").ssl.rejectUnauthorized, true);
  assert.equal(parameters("postgresql://test:test@localhost/test?host=db.example.com").ssl.rejectUnauthorized, true);
  assert.throws(() => parameters("postgresql://test:test@localhost/test?host=db.example.com&sslmode=disable"), /Remote databases require verified TLS/);
});

for (const options of ["sslmode=disable", "ssl=false", "ssl=0", "sslmode=no-verify", "ssl=no-verify", "sslmode=unknown", "sslmode=require&ssl=false", "sslmode=disable&ssl=true", "sslmode=disable&sslmode=require"]) {
  test(`rejects unsafe or conflicting remote TLS options: ${options}`, () => {
    assert.throws(() => parameters(`postgresql://test:test@db.example.com/test?${options}`), /TLS|SSL|ssl/);
  });
}

test("CA certificate options survive parsing without replacing verified TLS", (t) => {
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "boris-tls-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), require("node:os").tmpdir());
    assert.ok(path.basename(directory).startsWith("boris-tls-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const caPath = path.join(directory, "ca.pem");
  fs.writeFileSync(caPath, "synthetic CA contents for configuration test");
  const config = parameters(`postgresql://test:test@db.example.com/test?sslmode=require&sslrootcert=${encodeURIComponent(caPath)}`);
  assert.equal(config.ssl.ca, "synthetic CA contents for configuration test");
  assert.equal(config.ssl.rejectUnauthorized, true);
});

test("plain local connection sends a Postgres startup packet without TLS negotiation", async (t) => {
  let protocol;
  const server = net.createServer((socket) => {
    socket.once("data", (data) => {
      protocol = data.readInt32BE(4);
      socket.end();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new Client({
    ...buildDatabaseConfig(`postgresql://test:test@127.0.0.1:${server.address().port}/test`),
    connectionTimeoutMillis: 2000
  });
  t.after(() => client.end());
  await assert.rejects(client.connect(), /Connection terminated/);
  assert.equal(protocol, 196608, "Postgres protocol 3.0 startup, not an SSLRequest");
});
