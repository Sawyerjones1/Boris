const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadMarkdown(withMarked = true) {
  const context = vm.createContext({
    console, URL, URLSearchParams,
    window: {},
    document: {
      body: { dataset: { page: "test" } },
      getElementById: () => null,
      addEventListener() {}
    }
  });
  if (withMarked) {
    const markedPath = path.join(path.dirname(require.resolve("marked")), "marked.umd.js");
    vm.runInContext(fs.readFileSync(markedPath, "utf8"), context);
    context.window.marked = context.marked;
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../ui/assets/app.js"), "utf8"), context);
  return (text, fn = "renderRichMarkdown") => {
    context.input = text;
    return vm.runInContext(`${fn}(input)`, context);
  };
}

for (const href of [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,test",
  "vbscript:msgbox(1)", "//example.com/path", "/\\evil.test/path",
  "file:///etc/passwd", "ftp://example.com/file", "java\tscript:alert(1)"
]) {
  test(`rich Markdown rejects unsafe destination ${JSON.stringify(href)}`, () => {
    const render = loadMarkdown();
    const output = render(`[**click**](${href})`);
    assert.doesNotMatch(output, /<a\b/);
    assert.match(output, /click/);
  });
}

for (const href of [
  "https://example.com/path", "http://example.com/path", "mailto:person@example.com",
  "/records", "records", "./records", "../records", "#labs", "?days=7",
  "/records?first=1&second=2"
]) {
  test(`rich Markdown retains legitimate link ${href}`, () => {
    const render = loadMarkdown();
    const escapedHref = href.replace(/&/g, "&amp;");
    assert.equal(render(`[**click**](${href})`), `<p><a href="${escapedHref}"><strong>click</strong></a></p>\n`);
  });
}

test("reference links and images cannot bypass the URL policy", () => {
  const render = loadMarkdown();
  assert.equal(render("[click][target]\n\n[target]: javascript:alert(1)"), "<p>click</p>\n");
  assert.doesNotMatch(render("![image](data:text/html,test)"), /<img\b/);
  assert.doesNotMatch(render("![image](//example.com/image.png)"), /<img\b/);
  assert.match(render("![image](/assets/example.png)"), /<img src="\/assets\/example.png"/);
});

test("raw HTML and entity text stay inert while Markdown formatting survives", () => {
  const render = loadMarkdown();
  const output = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n**safe**');
  assert.doesNotMatch(output, /<(?:img|script)\b/);
  assert.match(output, /&lt;img/);
  assert.match(output, /<strong>safe<\/strong>/);
  assert.doesNotMatch(render('[click](javascript&#58;alert(1))'), /href="javascript:/i);
});

test("the inline renderer and fallback retain their internal-link restriction", () => {
  for (const render of [loadMarkdown(), loadMarkdown(false)]) {
    for (const fn of ["renderInlineMarkdown", "renderMarkdown"]) {
      assert.doesNotMatch(render("[click](javascript:alert(1)) [offsite](//example.com)", fn), /<a\b/);
      assert.match(render("[records](/records)", fn), /<a href="\/records">records<\/a>/);
    }
  }
});
