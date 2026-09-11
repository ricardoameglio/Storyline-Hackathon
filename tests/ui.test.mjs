import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { contentMarkup, contentText } from "../public/ui.js";

const html = await readFile(new URL("../public/interview.html", import.meta.url), "utf8");
const common = (await readFile(new URL("../public/ui.js", import.meta.url), "utf8")).replace(/^export /gm, "");
const source = (await readFile(new URL("../public/interview.js", import.meta.url), "utf8")).replace(/^import .*;\n/, "");
const assignment = { subjectName: "Alex", company: "Studio", angle: "Find the first customer story", durationMinutes: 10 };
const turn = { speaker: "interviewer", text: "What happened first?", move: "open" };
const initial = (overrides = {}) => ({ id: "int_test", status: "waiting", assignment, turns: [], beatsCovered: { Origin: false }, ...overrides });
const response = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => structuredClone(data) });
const flush = () => new Promise((resolve) => setImmediate(resolve));

// A deliberately small DOM harness exercises the actual controller and HTTP contract.
// Browser layout and platform speech behavior are checked separately in the running app.
async function room(handler, { operator = false, speech = false } = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const attributes = match[0];
    elements.set(match[1], {
      hidden: /\bhidden\b/.test(attributes), disabled: /\bdisabled\b/.test(attributes), value: "", textContent: "", innerHTML: "", style: {},
      classList: { toggle() {}, add() {} }, addEventListener() {}, focus() {},
    });
  }
  const inputs = ["voice", "text"].map((value) => ({ value, checked: value === "voice", addEventListener() {} }));
  const calls = [];
  let recognizer;
  const window = { addEventListener() {} };
  if (speech) window.SpeechRecognition = class {
    constructor() { recognizer = this; }
    start() {} stop() {}
  };
  const context = vm.createContext({
    window, document: { getElementById: (id) => elements.get(id), querySelectorAll: () => inputs },
    location: { search: operator ? "?operator=1" : "", pathname: "/i/int_test" },
    URLSearchParams, URL, AbortSignal, Date, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, body });
      return handler(url, body);
    },
  });
  vm.runInContext(`${common}\n${source}`, context);
  await flush();
  return { elements, calls, get: (id) => elements.get(id), run: (code) => vm.runInContext(code, context), recognizer: () => recognizer };
}

test("result rendering escapes every backend-controlled field and preserves plain-text copy", () => {
  const unsafe = '<img src=x onerror="alert(1)">';
  const content = { nail: unsafe, blogDraft: unsafe, linkedinPost: unsafe, instagramCaption: unsafe, podcastSegment: unsafe, pullQuotes: [{ quote: unsafe, why: unsafe }], xThread: [unsafe], contextGap: unsafe, corrections: [{ field: unsafe, claim: unsafe, problem: unsafe, fix: unsafe }] };
  const markup = contentMarkup(content);
  assert.ok(!markup.includes("<img"));
  assert.ok(markup.includes("&lt;img"));
  assert.ok(contentText(content).includes(unsafe));
  assert.ok(contentMarkup({}).includes("No story content"));
});

test("unsupported speech falls back to text and posts the actual typed answer", async () => {
  const live = initial({ status: "live", startedAt: Date.now(), turns: [turn] });
  const app = await room((url, body) => {
    if (url.endsWith("/start")) return response({ greeting: "Hello", question: { question: turn.text }, interview: live });
    if (url.endsWith("/answer")) return response({ question: { question: "Tell me more." }, interview: { ...live, turns: [turn, { speaker: "subject", text: body.text }, { ...turn, text: "Tell me more." }], beatsCovered: { Origin: true } } });
    return response(initial());
  });
  assert.equal(app.get("textAnswer").hidden, false);
  await app.get("start").onclick();
  app.get("answer").value = "Our first customer called on Monday.";
  await app.get("next").onclick();
  assert.equal(app.calls.find((call) => call.url.endsWith("/answer")).body.text, "Our first customer called on Monday.");
  assert.equal(app.get("answer").value, "");
  assert.equal(app.get("question").textContent, "Tell me more.");
  assert.equal(app.get("beatProgress").textContent, "1 of 1 topics explored");
});

test("continuing a saved interview never calls the destructive start endpoint", async () => {
  const app = await room(() => response(initial({ status: "live", startedAt: Date.now(), turns: [turn] })));
  await app.get("start").onclick();
  assert.equal(app.calls.filter((call) => call.url.endsWith("/start")).length, 0);
  assert.equal(app.get("live").hidden, false);
});

test("an answer persisted before an AI failure cannot be submitted twice", async () => {
  let saved = false;
  const live = initial({ status: "live", startedAt: Date.now(), turns: [turn] });
  const app = await room((url) => {
    if (url.endsWith("/answer")) { saved = true; return response({ error: "AI unavailable" }, false); }
    return response(saved ? { ...live, turns: [turn, { speaker: "subject", text: "A real answer" }] } : live);
  });
  await app.get("start").onclick();
  app.get("answer").value = "A real answer";
  await app.get("next").onclick();
  await app.get("next").onclick();
  assert.equal(app.calls.filter((call) => call.url.endsWith("/answer")).length, 1);
  assert.equal(app.get("next").disabled, true);
  assert.equal(app.get("finish").disabled, false);
  assert.match(app.get("err").textContent, /already be saved/);
});

test("an answer that was not saved remains editable and retryable", async () => {
  const app = await room((url) => url.endsWith("/answer") ? response({ error: "Offline" }, false) : response(initial({ status: "live", turns: [turn] })));
  await app.get("start").onclick();
  app.get("answer").value = "Keep this answer";
  await app.get("next").onclick();
  assert.equal(app.get("answer").value, "Keep this answer");
  assert.equal(app.get("next").disabled, false);
});

test("a lost answer response resumes from the saved follow-up without duplicating the answer", async () => {
  let saved = false;
  const live = initial({ status: "live", turns: [turn] });
  const app = await room((url) => {
    if (url.endsWith("/answer")) { saved = true; throw new Error("Connection lost"); }
    return response(saved ? { ...live, turns: [turn, { speaker: "subject", text: "My answer" }, { ...turn, text: "And then?" }] } : live);
  });
  await app.get("start").onclick();
  app.get("answer").value = "My answer";
  await app.get("next").onclick();
  assert.equal(app.get("question").textContent, "And then?");
  assert.equal(app.get("answer").value, "");
  assert.equal(app.get("statusLabel").textContent, "Your turn");
  assert.equal(app.get("err").textContent, "");
});

test("an AI closing turn displays completion and stops further submissions", async () => {
  const live = initial({ status: "live", startedAt: Date.now(), turns: [turn] });
  const app = await room((url) => url.endsWith("/answer") ? response({ question: { question: "Thank you." }, interview: { ...live, status: "finished", endedAt: Date.now(), turns: [turn, { speaker: "subject", text: "My answer" }, { ...turn, text: "Thank you." }] } }) : response(live));
  await app.get("start").onclick();
  app.get("answer").value = "My answer";
  await app.get("next").onclick();
  assert.equal(app.get("end").hidden, false);
  assert.equal(app.get("live").hidden, true);
  assert.equal(app.get("next").disabled, true);
});

test("failed finish keeps the conversation visible and allows another finish attempt", async () => {
  const app = await room((url) => url.endsWith("/end") ? response({ error: "Offline" }, false) : response(initial({ status: "live", turns: [turn] })));
  await app.get("start").onclick();
  await app.get("finish").onclick();
  assert.equal(app.get("end").hidden, true);
  assert.equal(app.get("live").hidden, false);
  assert.equal(app.get("finish").disabled, false);
});

test("operator reload renders saved content without another generation request", async () => {
  const app = await room(() => response(initial({ status: "finished", turns: [turn], content: { linkedinPost: "Saved copy" } })), { operator: true });
  assert.equal(app.get("result").hidden, false);
  assert.match(app.get("result").innerHTML, /Saved copy/);
  assert.equal(app.calls.length, 1);
});

test("subject completion keeps operator content and reasoning hidden", async () => {
  const app = await room(() => response(initial({ status: "finished", turns: [turn], content: { nail: "Editor content" } })));
  assert.equal(app.get("editorResults").hidden, true);
  assert.equal(app.get("logBox").hidden, true);
});

test("empty interviews cannot generate content", async () => {
  const app = await room(() => response(initial({ status: "finished" })), { operator: true });
  assert.equal(app.get("generate").disabled, true);
  await app.get("generate").onclick();
  assert.equal(app.calls.length, 1);
});

test("generation pending and error states are recoverable", async () => {
  let complete;
  const app = await room((url) => url.endsWith("/content") ? new Promise((resolve) => { complete = resolve; }) : response(initial({ status: "finished", turns: [turn, { speaker: "subject", text: "Answer" }] })), { operator: true });
  const pending = app.get("generate").onclick();
  assert.equal(app.get("processing").hidden, false);
  assert.equal(app.get("generate").disabled, true);
  complete(response({ error: "Try later" }, false));
  await pending;
  assert.equal(app.get("processing").hidden, true);
  assert.equal(app.get("generate").disabled, false);
  assert.equal(app.get("generatePrompt").hidden, false);
  assert.equal(app.get("resultError").textContent, "Try later");
});

test("voice recognition denial switches to text without losing the current draft", async () => {
  const app = await room((url) => url === "/api/tts" ? { status: 204, ok: true } : response(initial({ status: "live", turns: [turn] })), { speech: true });
  await app.get("start").onclick();
  app.run('finalText = "Keep these words"');
  app.recognizer().onerror({ error: "not-allowed" });
  assert.equal(app.get("textAnswer").hidden, false);
  assert.equal(app.get("answer").value, "Keep these words");
  assert.match(app.get("err").textContent, /Microphone access is blocked/);
});

test("invalid room displays a useful error and leaves start disabled", async () => {
  const app = await room(() => response({ error: "No such interview." }, false));
  assert.equal(app.get("start").disabled, true);
  assert.match(app.get("introError").textContent, /No such interview/);
});
