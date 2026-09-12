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
  get("questionLimit").value = "unlimited";
  get("maxQuestions").disabled = true;
  get("stylePersonal").checked = true;
  get("stylePersonal").value = "personal";
  const calls = [];
  const navigations = [];
  const windowEvents = {};
  const context = vm.createContext({
    document: { getElementById: get }, window: { addEventListener(name, handler) { windowEvents[name] = handler; } }, location: { origin: "http://localhost:8787", assign(url) { navigations.push(url); } },
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
  return { get, calls, navigations, windowEvents, run: (code) => vm.runInContext(code, context) };
}

test("assignment creation preserves optional fields and existing request shapes", async () => {
  const app = await studio(url => response(url === "/api/assignments" ? { id: "asg_test" } : { url: "http://localhost:8787/i/test" }));
  app.get("subjectName").value = " Alex ";
  app.get("durationMinutes").value = "5";
  app.get("maxQuestions").value = "4";
  app.get("questionLimit").value = "limited";
  app.get("questionLimit").listeners.change();
  app.get("language").value = "es";
  await app.run("createAssignment()");
  assert.deepEqual(app.calls, [
    { url: "/api/assignments", body: { subjectName: "Alex", company: "", interviewType: "personal", durationMinutes: 5, maxQuestions: 4, language: "es" } },
    { url: "/api/interviews", body: { assignmentId: "asg_test" } },
  ]);
  assert.deepEqual(app.navigations, ["http://localhost:8787/i/test"]);
  assert.equal(app.get("go").disabled, true);
});

test("self-serve works without a name and preserves selected settings", async () => {
  const app = await studio(() => response({ url: "http://localhost:8787/i/quick" }));
  app.get("durationMinutes").value = "15";
  app.get("language").value = "es";
  await app.get("quick").onclick();
  assert.deepEqual(app.calls, [{ url: "/api/quickstart", body: { interviewType: "personal", durationMinutes: 15, language: "es" } }]);
  assert.deepEqual(app.navigations, ["http://localhost:8787/i/quick"]);
});

test("choosing guided setup skips the brief and switching back restores the draft", async () => {
  const app = await studio(() => response({ url: "http://localhost:8787/i/quick" }));
  app.get("subjectName").value = "Alex";
  app.get("stylePersonal").checked = false;
  app.get("styleCareer").checked = true;
  app.get("styleCareer").value = "career";
  app.get("durationMinutes").value = "15";
  app.get("guidedMode").listeners.change();
  assert.equal(app.get("personFields").disabled, true);
  assert.equal(app.get("storyFields").hidden, false);
  assert.equal(app.get("quick").hidden, false);
  assert.equal(app.get("go").hidden, true);
  assert.match(app.get("previewTitle").textContent, /starts in the room/);
  app.get("assignmentForm").listeners.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(app.calls, [{ url: "/api/quickstart", body: { interviewType: "career", durationMinutes: 15, language: "en" } }]);
  assert.deepEqual(app.navigations, ["http://localhost:8787/i/quick"]);
  app.run("setCreating(false, true)"); // Simulate returning to setup after navigation.
  app.get("manualMode").listeners.change();
  assert.equal(app.get("personFields").disabled, false);
  assert.equal(app.get("storyFields").hidden, false);
  assert.equal(app.get("subjectName").value, "Alex");
  assert.equal(app.get("styleCareer").checked, true);
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
  assert.equal(app.get("settingsPanel").open, true);
});

test("untouched settings use ten minutes and unlimited; limits survive toggling", async () => {
  const app = await studio(url => response(url === "/api/assignments" ? { id: "asg_test" } : { url: "http://localhost:8787/i/test" }));
  app.get("subjectName").value = "Alex";
  await app.run("createAssignment()");
  assert.equal(app.calls[0].body.durationMinutes, 10);
  assert.equal(app.calls[0].body.maxQuestions, undefined);
  assert.equal(app.get("configSummary").textContent, "English · 10 min · Unlimited questions");
  app.run("setCreating(false, false)"); // A fresh visit after the first navigation.
  app.get("questionLimit").value = "limited";
  app.get("questionLimit").listeners.change();
  app.get("maxQuestions").value = "10";
  app.get("durationMinutes").value = "5";
  await app.run("createAssignment()");
  assert.equal(app.calls[2].body.maxQuestions, 10);
  assert.equal(app.calls[2].body.durationMinutes, 5);
  app.get("questionLimit").value = "unlimited";
  app.get("questionLimit").listeners.change();
  assert.equal(app.get("maxQuestions").disabled, true);
  assert.equal(app.get("questionCountField").hidden, true);
  assert.equal(app.get("maxQuestions").value, "10");
  assert.equal(app.run("selectedQuestionLimit()"), undefined);
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
  assert.deepEqual(app.navigations, []);
});

test("repeated creation clicks issue one room request and remain locked until navigation", async () => {
  let complete;
  const app = await studio(url => url === "/api/assignments" ? response({ id: "asg_actual" }) : new Promise(resolve => { complete = resolve; }));
  app.get("subjectName").value = "Alex";
  const pending = app.run("createAssignment()");
  await new Promise(resolve => setImmediate(resolve));
  await app.run("createAssignment()");
  await app.get("quick").onclick();
  assert.deepEqual(app.navigations, []);
  assert.equal(app.calls.filter(c => c.url === "/api/interviews").length, 1);
  assert.match(app.get("go").innerHTML, /Creating room/);
  complete(response({ id: "real_id", url: "/i/real_id" }));
  await pending;
  await app.run("createAssignment()");
  assert.deepEqual(app.navigations, ["http://localhost:8787/i/real_id"]);
  assert.equal(app.calls.length, 2);
});

test("room creation failure stays on setup and can retry", async () => {
  let fail = true;
  const app = await studio(url => url === "/api/assignments" ? response({ id: "asg_retry" }) : response(fail ? { error: "Couldn't create the interview room. Try again." } : { url: "/i/retried" }, !fail));
  app.get("subjectName").value = "Alex";
  await app.run("createAssignment()");
  assert.deepEqual(app.navigations, []);
  assert.equal(app.get("go").disabled, false);
  assert.match(app.get("formError").textContent, /Try again/);
  fail = false;
  await app.run("createAssignment()");
  assert.deepEqual(app.navigations, ["http://localhost:8787/i/retried"]);
});

test("missing or unsafe room URLs do not navigate and share UI is absent", async () => {
  for (const url of [undefined, "", "javascript:alert(1)"]) {
    const app = await studio(() => response({ url }));
    await app.get("quick").onclick();
    assert.deepEqual(app.navigations, []);
    assert.equal(app.get("quick").disabled, false);
    assert.match(app.get("formError").textContent, /room link/);
  }
  assert.doesNotMatch(html, /READY TO SHARE|QRCode|qrcode.min.js|id="openRoom"|id="copyRoom"|id="qr"|Room created\./);
});

test("returning with Back restores controls and synchronizes browser-restored settings", async () => {
  const app = await studio(() => response({ url: "/i/back-test" }));
  await app.get("quick").onclick();
  app.get("guidedMode").checked = true;
  app.get("durationMinutes").value = "5";
  app.get("questionLimit").value = "limited";
  app.get("maxQuestions").value = "10";
  app.windowEvents.pageshow();
  assert.equal(app.get("quick").disabled, false);
  assert.equal(app.get("maxQuestions").disabled, false);
  assert.equal(app.get("personFields").hidden, true);
  assert.equal(app.get("configSummary").textContent, "English · 5 min · Up to 10 questions");
});

test("preview and CTA summary follow the actual inputs and avoid HTML injection", async () => {
  const app = await studio(() => response({}));
  app.get("subjectName").value = "<b>Alex</b>";
  app.get("subjectRole").value = "Founder";
  app.get("company").value = "Studio";
  app.get("durationMinutes").value = "15";
  app.get("maxQuestions").value = "3";
  app.get("questionLimit").value = "limited";
  app.get("questionLimit").listeners.change();
  app.get("language").selectedOptions[0].textContent = "Español";
  app.run("updateBrief()");
  assert.equal(app.get("previewTitle").textContent, "A conversation with <b>Alex</b>.");
  assert.equal(app.get("previewTitle").innerHTML, "");
  assert.equal(app.get("previewPerson").textContent, "Founder · Studio");
  assert.match(app.get("previewAngle").textContent, /Personal Story/);
  assert.equal(app.get("configSummary").textContent, "Español · 15 min · Up to 3 questions");
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
