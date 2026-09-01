const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../ui/assets/app.js"), "utf8");
const html = readFileSync(join(__dirname, "../ui/dev-logs.html"), "utf8");
const log = {
  id: "sample-request",
  createdAt: "2026-09-05T12:00:00Z",
  label: "Sample request",
  model: "sample-model",
  source: "chat",
  success: true,
  inputText: "Sample prompt",
  outputText: "Sample response",
  inputTokens: 100,
  outputTokens: 27,
  totalTokens: 127,
  estimatedCostUsd: 0.000099,
  metadata: { example: true }
};
const totals = { calls: 1, totalTokens: 127, estimatedCost: 0.000099 };
const summary = { today: totals, last7Days: totals, last30Days: totals };

// Run the actual frontend with an in-memory DOM and API; no credentials or live data needed.
function createPage(respond) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, {
    value: id === "dev-logs-status" ? "all" : "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
  }]));
  const requests = [];
  const context = vm.createContext({
    console,
    URLSearchParams,
    window: { setTimeout, clearTimeout },
    document: {
      body: { dataset: { page: "test" } },
      getElementById: (id) => nodes.get(id),
      addEventListener() {}
    },
    fetch: async (url) => {
      requests.push(url);
      const payload = await respond(url);
      return { ok: true, json: async () => payload };
    }
  });
  vm.runInContext(source, context);
  return {
    nodes,
    requests,
    run: (code) => vm.runInContext(code, context),
    click: (id, selector) => nodes.get(id).listeners.click({
      target: { closest: (value) => value === selector ? {} : null }
    })
  };
}

function normalResponse(url) {
  if (url === "/dev/logs/summary") return summary;
  if (url.startsWith("/dev/logs?")) return [log];
  if (url === `/dev/logs/${log.id}`) return log;
  throw new Error(`Unexpected URL: ${url}`);
}

test("page loads summary, individual calls, and the first request's details", async () => {
  const page = createPage(normalResponse);
  await page.run("setupDevLogsPage()");
  assert.match(page.nodes.get("dev-logs-summary-today").textContent, /127 tokens/);
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /Sample request/);
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Sample prompt/);
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Sample response/);
  assert.equal(page.nodes.get("dev-logs-list-meta").textContent, "Calls 1–1");
  assert.ok(page.requests.includes("/dev/logs?limit=21&offset=0"));
});

test("CSV export uses the selected filters and includes request contents", async () => {
  const page = createPage(normalResponse);
  page.nodes.get("dev-logs-source").value = "chat";
  page.nodes.get("dev-logs-search").value = "Sample & request";
  page.nodes.get("dev-logs-status").value = "errors";
  page.run("downloadCsv = (content, fileName) => { globalThis.download = { content, fileName } }");
  await page.run("exportDevLogsCsv()");
  const query = new URL(page.requests[0], "http://localhost").searchParams;
  assert.equal(query.get("source"), "chat");
  assert.equal(query.get("search"), "Sample & request");
  assert.equal(query.get("errorsOnly"), "true");
  assert.equal(query.get("limit"), "500");
  assert.equal(query.get("offset"), "0");
  assert.match(page.run("download.content"), /"Sample prompt","Sample response"/);
  assert.match(page.run("download.fileName"), /^boris-dev-logs-.*\.csv$/);
});

test("list failure shows retry and leaves controls working", async () => {
  let failing = true;
  const page = createPage((url) => {
    if (failing && url.startsWith("/dev/logs?")) throw new Error("Offline");
    return normalResponse(url);
  });
  await page.run("setupDevLogsPage()");
  assert.match(page.nodes.get("dev-logs-list-meta").textContent, /Could not load logs/);
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /data-dev-logs-retry/);
  assert.equal(page.run("devLogsState.loadingList"), false);
  assert.equal(typeof page.nodes.get("dev-logs-source").listeners.change, "function");
  failing = false;
  await page.click("dev-logs-list", "[data-dev-logs-retry]");
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /Sample request/);
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Sample response/);
});

test("a failed summary request does not prevent the call list from loading", async () => {
  const page = createPage((url) => {
    if (url === "/dev/logs/summary") throw new Error("Unavailable");
    return normalResponse(url);
  });
  await page.run("setupDevLogsPage()");
  assert.equal(page.nodes.get("dev-logs-summary-today").textContent, "Summary unavailable");
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /Sample request/);
});

test("a failed detail request leaves the list usable and can be retried", async () => {
  let failing = true;
  const page = createPage((url) => {
    if (failing && url === `/dev/logs/${log.id}`) throw new Error("Unavailable");
    return normalResponse(url);
  });
  await page.run("setupDevLogsPage()");
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Select it again to retry/);
  assert.equal(page.nodes.get("dev-logs-list-meta").textContent, "Calls 1–1");
  failing = false;
  await page.run(`loadDevLogDetail(${JSON.stringify(log.id)})`);
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Sample prompt/);
});

test("empty filtered results explain the filters, and clearing them reloads calls", async () => {
  const page = createPage((url) => url.includes("source=doctor") ? [] : normalResponse(url));
  await page.run("setupDevLogsPage()");
  page.nodes.get("dev-logs-source").value = "doctor";
  await page.nodes.get("dev-logs-source").listeners.change();
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /No API calls match your filters/);
  assert.match(page.nodes.get("dev-logs-detail").innerHTML, /Select a log/);
  await page.click("dev-logs-clear");
  assert.match(page.nodes.get("dev-logs-list").innerHTML, /Sample request/);
});

function paginatedResponse(count) {
  const logs = Array.from({ length: count }, (_, index) => ({ ...log, id: `request-${index + 1}` }));
  return (url) => {
    if (url === "/dev/logs/summary") return summary;
    if (url.startsWith("/dev/logs?")) {
      const params = new URL(url, "http://localhost").searchParams;
      const offset = Number(params.get("offset"));
      return logs.slice(offset, offset + Number(params.get("limit")));
    }
    return logs.find(item => url === `/dev/logs/${item.id}`);
  };
}

test("pages replace calls, select the first detail, and stop at a full final page", async () => {
  const page = createPage(paginatedResponse(40));
  await page.run("setupDevLogsPage()");
  assert.equal(page.run("devLogsState.items.length"), 20);
  assert.equal(page.nodes.get("dev-logs-page-size").value, "20");
  assert.equal(page.nodes.get("dev-logs-previous").disabled, true);
  assert.equal(page.nodes.get("dev-logs-next").disabled, false);
  await page.click("dev-logs-next");
  assert.equal(page.run("devLogsState.items.length"), 20);
  assert.equal(page.run("devLogsState.selectedId"), "request-21");
  assert.equal(page.nodes.get("dev-logs-page").textContent, "Page 2");
  assert.equal(page.nodes.get("dev-logs-list-meta").textContent, "Calls 21–40");
  assert.equal(page.nodes.get("dev-logs-next").disabled, true);
  assert.equal(page.nodes.get("dev-logs-previous").disabled, false);
  await page.click("dev-logs-previous");
  assert.equal(page.run("devLogsState.selectedId"), "request-1");
  assert.equal(page.nodes.get("dev-logs-list-meta").textContent, "Calls 1–20");
});

test("a partial final page contains only the remaining calls", async () => {
  const page = createPage(paginatedResponse(23));
  await page.run("setupDevLogsPage()");
  await page.click("dev-logs-next");
  assert.equal(page.run("devLogsState.items.length"), 3);
  assert.equal(page.nodes.get("dev-logs-list-meta").textContent, "Calls 21–23");
  assert.equal(page.nodes.get("dev-logs-next").disabled, true);
});

test("changing page size or filters returns to page one", async () => {
  const page = createPage(paginatedResponse(60));
  await page.run("setupDevLogsPage()");
  await page.click("dev-logs-next");
  page.nodes.get("dev-logs-page-size").value = "7";
  await page.nodes.get("dev-logs-page-size").listeners.change();
  assert.equal(page.run("devLogsState.items.length"), 7);
  assert.equal(page.nodes.get("dev-logs-page").textContent, "Page 1");
  await page.click("dev-logs-next");
  assert.equal(page.run("devLogsState.offset"), 7);
  page.nodes.get("dev-logs-source").value = "chat";
  await page.nodes.get("dev-logs-source").listeners.change();
  assert.equal(page.run("devLogsState.offset"), 0);
  assert.equal(page.run("devLogsState.limit"), 7);
  assert.ok(page.requests.includes("/dev/logs?source=chat&limit=8&offset=0"));
});

test("invalid page sizes normalize to supported whole numbers", async () => {
  const page = createPage(paginatedResponse(120));
  await page.run("setupDevLogsPage()");
  for (const [value, expected] of [["", 20], ["-5", 1], ["3.7", 3], ["999", 100]]) {
    page.nodes.get("dev-logs-page-size").value = value;
    await page.nodes.get("dev-logs-page-size").listeners.change();
    assert.equal(page.nodes.get("dev-logs-page-size").value, String(expected));
    assert.equal(page.run("devLogsState.items.length"), expected);
  }
});

test("failed page navigation preserves the current page and can be retried", async () => {
  let failing = true;
  const respond = paginatedResponse(40);
  const page = createPage((url) => {
    if (failing && url.includes("offset=20")) throw new Error("Unavailable");
    return respond(url);
  });
  await page.run("setupDevLogsPage()");
  await page.click("dev-logs-next");
  assert.equal(page.run("devLogsState.selectedId"), "request-1");
  assert.equal(page.nodes.get("dev-logs-page").textContent, "Page 1");
  assert.equal(page.nodes.get("dev-logs-next").disabled, false);
  failing = false;
  await page.click("dev-logs-next");
  assert.equal(page.run("devLogsState.selectedId"), "request-21");
  assert.equal(page.requests.filter(url => url.includes("offset=20")).length, 2);
});

test("a pending page request cannot overwrite newer page-size results", async () => {
  let finishOldRequest;
  const respond = paginatedResponse(60);
  const page = createPage(url => {
    if (url.includes("offset=20")) return new Promise(resolve => { finishOldRequest = () => resolve(respond(url)); });
    return respond(url);
  });
  await page.run("setupDevLogsPage()");
  const pending = page.click("dev-logs-next");
  assert.equal(page.nodes.get("dev-logs-next").disabled, true);
  page.nodes.get("dev-logs-page-size").value = "5";
  await page.nodes.get("dev-logs-page-size").listeners.change();
  finishOldRequest();
  await pending;
  assert.equal(page.run("devLogsState.offset"), 0);
  assert.equal(page.run("devLogsState.items.length"), 5);
  assert.equal(page.run("devLogsState.selectedId"), "request-1");
});
