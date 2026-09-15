const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("HTTP inputs and responses have basic local-server hardening", () => {
  const server = read("server.js");
  assert.match(server, /app\.disable\("x-powered-by"\)/);
  assert.match(server, /X-Content-Type-Options", "nosniff"/);
  assert.match(server, /X-Frame-Options", "DENY"/);
  assert.match(server, /Referrer-Policy", "no-referrer"/);
  assert.match(server, /express\.urlencoded\(\{ extended: true, limit: "1mb", parameterLimit: 1000 \}\)/);
  assert.match(server, /fileSize: 15 \* 1024 \* 1024,[\s\S]*files: 1,[\s\S]*fields: 20,[\s\S]*parts: 21/);
});

test("retired feature-planning code and unused PDF conversion dependency are absent", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.dependencies.pdf2pic, undefined);
  assert.equal(fs.existsSync(path.join(root, "ui", "features.html")), false);

  for (const file of ["server.js", "core/neon.js", "ui/assets/app.js", "ui/assets/style.css"]) {
    const source = read(file);
    assert.doesNotMatch(source, /feature_items|featuresState|setupFeaturesPage|\/features\/items/);
  }
});

test("public configuration templates exclude local credentials", () => {
  const gitignore = read(".gitignore");
  const envExample = read(".env.example");
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^config\.json$/m);
  assert.match(envExample, /^OPENAI_API_KEY=$/m);
  assert.match(envExample, /^DATABASE_URL=$/m);
});
