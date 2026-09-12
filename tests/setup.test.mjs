import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../public/setup.js", import.meta.url), "utf8");
const response = (body, ok = true) => ({ ok, json: async () => body });
const emptyWall = { stats: { interviewsFinished: 0, minutesOnTheRecord: 0, questionsAsked: 0 }, rows: [] };

async function setup(handler) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], {
    value: "", textContent: "", innerHTML: "", hidden: true, disabled: false,
    reportValidity: () => true, addEventListener() {}, focus() {}, replaceChildren() {},
  }]));
  elements.get("durationMinutes").value = "10";
  elements.get("language").value = "en";
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: (id) => elements.get(id) }, window: {}, URL,
    location: { origin: "http://localhost:8787" }, navigator: {}, setInterval() {},
    fetch: async (url, options) => {
      if (url === "/api/wall") return response(emptyWall);
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      return handler(url, body);
    },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { get: (id) => elements.get(id), calls, create: (quick) => vm.runInContext(`createRoom(${quick})`, context) };
}

test("regular creation keeps business and angle optional and passes interview settings", async () => {
  const app = await setup((url) => response(url === "/api/assignments" ? { id: "asg_test" } : { url: "http://localhost:8787/i/test" }));
  app.get("subjectName").value = "  Alex  ";
  app.get("maxQuestions").value = "4";
  app.get("language").value = "es";
  await app.create(false);
  assert.deepEqual(app.calls[0], { url: "/api/assignments", body: { subjectName: "Alex", company: "", angle: "", durationMinutes: 10, maxQuestions: 4, language: "es" } });
  assert.deepEqual(app.calls[1], { url: "/api/interviews", body: { assignmentId: "asg_test" } });
  assert.equal(app.get("out").hidden, false);
  assert.match(app.get("shareStatus").textContent, /QR unavailable/);
  assert.equal(app.get("operatorLink").href, "http://localhost:8787/i/test?operator=1");
});

test("self-serve creation needs no name and sends the selected options", async () => {
  const app = await setup(() => response({ url: "http://localhost:8787/i/quick" }));
  app.get("durationMinutes").value = "5";
  app.get("maxQuestions").value = "3";
  app.get("language").value = "es";
  await app.create(true);
  assert.deepEqual(app.calls, [{ url: "/api/quickstart", body: { durationMinutes: 5, maxQuestions: 3, language: "es" } }]);
  assert.match(app.get("roomTitle").textContent, /self-serve/);
});

test("missing name or invalid options do not create a room", async () => {
  const app = await setup(() => { throw new Error("Must not send a request"); });
  await app.create(false);
  assert.equal(app.calls.length, 0);
  app.get("durationMinutes").reportValidity = () => false;
  await app.create(true);
  assert.equal(app.calls.length, 0);
});

test("both creation buttons are locked while a request is pending", async () => {
  let finish;
  const app = await setup(() => new Promise((resolve) => { finish = resolve; }));
  const pending = app.create(true);
  assert.equal(app.get("go").disabled, true);
  assert.equal(app.get("quick").disabled, true);
  await app.create(true);
  assert.equal(app.calls.length, 1);
  finish(response({ url: "http://localhost:8787/i/quick" }));
  await pending;
  assert.equal(app.get("go").disabled, false);
  assert.equal(app.get("quick").disabled, false);
});

test("room creation retry reuses an assignment and preserves input after failure", async () => {
  let attempts = 0;
  const app = await setup((url) => {
    if (url === "/api/assignments") return response({ id: "asg_test" });
    return ++attempts === 1 ? response({ error: "Please retry" }, false) : response({ url: "http://localhost:8787/i/test" });
  });
  app.get("subjectName").value = "Alex";
  await app.create(false);
  assert.equal(app.get("error").textContent, "Please retry");
  assert.equal(app.get("subjectName").value, "Alex");
  await app.create(false);
  assert.equal(app.calls.filter((call) => call.url === "/api/assignments").length, 1);
  assert.equal(app.get("out").hidden, false);
});

test("server errors use text content and unsafe room links are rejected", async () => {
  const app = await setup(() => response({ error: "<img src=x onerror=alert(1)>" }, false));
  await app.create(true);
  assert.equal(app.get("error").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(app.get("error").innerHTML, "");
  const unsafe = await setup(() => response({ url: "javascript:alert(1)" }));
  await unsafe.create(true);
  assert.match(unsafe.get("error").textContent, /invalid room link/);
  assert.equal(unsafe.get("out").hidden, true);
});
