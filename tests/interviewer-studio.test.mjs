import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const response = (data, ok = true) => ({ ok, json: async () => data });
const empty = { stats: { interviewsFinished: 0, minutesOnTheRecord: 0, questionsAsked: 0 }, rows: [] };

async function studio(handler, wallData = empty) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
      validity: { valid: true }, selectedOptions: [{ textContent: "English" }],
      reportValidity() { return this.validity.valid; },
      listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; }, setAttribute() {}, focus() {},
    });
    return elements.get(id);
  };
  get("durationMinutes").value = "10";
  get("language").value = "en";
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: get }, window: {}, location: { origin: "http://localhost:8787" },
    URL, navigator: {}, setInterval() {},
    fetch: async (url, options) => {
      if (url === "/api/wall") return response(wallData);
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return handler(url, body);
    },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { get, calls, run: (code) => vm.runInContext(code, context) };
}

test("assignment creation preserves optional fields and existing request shapes", async () => {
  const app = await studio(url => response(url === "/api/assignments" ? { id: "asg_test" } : { url: "http://localhost:8787/i/test" }));
  app.get("subjectName").value = " Alex ";
  app.get("durationMinutes").value = "5";
  app.get("maxQuestions").value = "4";
  app.get("language").value = "es";
  await app.run("createAssignment()");
  assert.deepEqual(app.calls, [
    { url: "/api/assignments", body: { subjectName: "Alex", company: "", angle: "", durationMinutes: 5, maxQuestions: 4, language: "es" } },
    { url: "/api/interviews", body: { assignmentId: "asg_test" } },
  ]);
  assert.match(app.get("out").innerHTML, /test\?operator=1/);
  assert.equal(app.get("requestStatus").textContent, "Room created.");
  assert.match(app.get("copyStatus").textContent, /QR unavailable/);
});

test("self-serve works without a name and preserves selected settings", async () => {
  const app = await studio(() => response({ url: "http://localhost:8787/i/quick" }));
  app.get("durationMinutes").value = "15";
  app.get("language").value = "es";
  await app.get("quick").onclick();
  assert.deepEqual(app.calls, [{ url: "/api/quickstart", body: { durationMinutes: 15, language: "es" } }]);
});

test("choosing guided setup skips the brief and switching back restores the draft", async () => {
  const app = await studio(() => response({ url: "http://localhost:8787/i/quick" }));
  app.get("subjectName").value = "Alex";
  app.get("angle").value = "A new beginning";
  app.get("durationMinutes").value = "15";
  app.get("guidedMode").listeners.change();
  assert.equal(app.get("personFields").disabled, true);
  assert.equal(app.get("storyFields").hidden, true);
  assert.equal(app.get("quick").hidden, false);
  assert.equal(app.get("go").hidden, true);
  assert.match(app.get("previewTitle").textContent, /starts in the room/);
  app.get("assignmentForm").listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.calls, [{ url: "/api/quickstart", body: { durationMinutes: 15, language: "en" } }]);
  assert.match(app.get("out").innerHTML, /Open interview/);
  app.get("manualMode").listeners.change();
  assert.equal(app.get("personFields").disabled, false);
  assert.equal(app.get("storyFields").hidden, false);
  assert.equal(app.get("subjectName").value, "Alex");
  assert.equal(app.get("angle").value, "A new beginning");
  assert.equal(app.get("durationMinutes").value, "15");
  assert.match(app.get("previewTitle").textContent, /Alex/);
});

test("invalid form and invalid self-serve settings do not send requests", async () => {
  const app = await studio(() => { throw new Error("Unexpected request"); });
  await app.run("createAssignment()");
  assert.match(app.get("formError").textContent, /Add a name/);
  app.get("durationMinutes").validity.valid = false;
  await app.get("quick").onclick();
  assert.equal(app.calls.length, 0);
});

test("pending creation disables both paths and failure restores controls without losing the brief", async () => {
  let finish;
  const app = await studio(() => new Promise(resolve => { finish = resolve; }));
  app.get("subjectName").value = "Alex";
  const pending = app.get("quick").onclick();
  await app.get("quick").onclick();
  await app.run("createAssignment()");
  assert.equal(app.calls.length, 1);
  assert.equal(app.get("go").disabled, true);
  finish(response({ error: "<img src=x onerror=alert(1)>" }, false));
  await pending;
  assert.equal(app.get("go").disabled, false);
  assert.equal(app.get("quick").disabled, false);
  assert.equal(app.get("subjectName").value, "Alex");
  assert.equal(app.get("formError").innerHTML, "");
  assert.equal(app.get("formError").textContent, "<img src=x onerror=alert(1)>");
});

test("preview and CTA summary follow the actual inputs and avoid HTML injection", async () => {
  const app = await studio(() => response({}));
  app.get("subjectName").value = "<b>Alex</b>";
  app.get("subjectRole").value = "Founder";
  app.get("company").value = "Studio";
  app.get("angle").value = "What changed?";
  app.get("durationMinutes").value = "15";
  app.get("maxQuestions").value = "3";
  app.get("language").selectedOptions[0].textContent = "Español";
  app.run("updateBrief()");
  assert.equal(app.get("previewTitle").textContent, "A conversation with <b>Alex</b>.");
  assert.equal(app.get("previewTitle").innerHTML, "");
  assert.equal(app.get("previewPerson").textContent, "Founder · Studio");
  assert.equal(app.get("previewAngle").textContent, "What changed?");
  assert.equal(app.get("configSummary").textContent, "15 min · Español · Up to 3 questions");
  app.get("durationMinutes").validity.valid = false;
  app.run("updateBrief()");
  assert.match(app.get("configSummary").textContent, /Choose 2–30 minutes/);
});

test("history preserves returned metadata and routes, escapes content, and omits absent story fields", async () => {
  const app = await studio(() => response({}), { ...empty, rows: [{ interviewId: "test/id", subject: "<script>alert(1)</script>", company: "Studio", minutes: 1.8, questions: 4, nail: "A real highlight", topQuote: "An actual quote" }] });
  const rendered = app.get("wall").innerHTML;
  assert.ok(!rendered.includes("<script>"));
  assert.match(rendered, /A real highlight/);
  assert.match(rendered, /An actual quote/);
  assert.match(rendered, /1.8 min/);
  assert.match(rendered, /4 questions/);
  assert.match(rendered, /\/i\/test%2Fid\?operator=1/);
  const noStory = await studio(() => response({}), { ...empty, rows: [{ interviewId: "one", subject: "Alex", minutes: 2, questions: 3 }] });
  assert.ok(!noStory.get("wall").innerHTML.includes("item-nail"));
  assert.ok(!noStory.get("wall").innerHTML.includes("blockquote"));
});
