import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dataDir = await mkdtemp(join(tmpdir(), "prologue-test-"));
process.env.PROLOGUE_DATA_DIR = dataDir;
process.env.ANTHROPIC_API_KEY = "test-only";
process.env.RESEND_API_KEY = "test-only";
process.env.EMAIL_FROM = "Prologue <test@example.com>";
const { app } = await import("../src/server.ts");
const { store } = await import("../src/store.ts");
const { anthropic } = await import("../src/anthropic.ts");
const { preservesWords, formatTranscriptText, prepareTranscript } = await import("../src/transcript.ts");
const { interviewPdf } = await import("../src/pdf.ts");
const raw = "yeah so we started um probably in 2024 and then I guess after like three months we realized it wasn’t working";
const cleaned = "Yeah, so we started probably in 2024. And then, I guess after like three months, we realized it wasn’t working.";
let failGeneration = false;
let failEmail = false;
let cleanupOverride;
let generations = 0;
let sentEmails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(options.body));
    await new Promise(resolve => setTimeout(resolve, 120));
    return new Response(JSON.stringify(failEmail ? { error: "test failure" } : { id: "mock-email" }), { status: failEmail ? 500 : 200 });
  }
  // Tests must never contact external services.
  if (!String(url).startsWith("http://127.0.0.1:")) throw new Error(`Unexpected outbound request: ${url}`);
  return realFetch(url, options);
};
anthropic.messages.create = async request => {
  const name = request.tool_choice.name;
  let input;
  if (name === "ask") input = { question: "Thanks for sharing your story.", move: "close", reasoning: "Test close", topic: "story", beats_now_covered: [], should_end: true };
  if (name === "clean") input = { answers: JSON.parse(request.messages[0].content).map(text => cleanupOverride || (text === raw ? cleaned : formatTranscriptText(text))) };
  if (name === "deliver") {
    generations++;
    await new Promise(resolve => setTimeout(resolve, 40));
    if (failGeneration) throw new Error("Simulated generation failure");
    input = { nail: "Three months changed our direction", summary: "We started in 2024. After three months, we realized it wasn’t working.", keyTakeaways: ["The business started in 2024.", "Three months brought a realization."], pullQuotes: [{ quote: "we realized it wasn’t working", why: "The turning point." }], linkedinPost: "We started in 2024. Three months later, we realized it wasn’t working." };
  }
  if (name === "check") input = { corrections: [] };
  if (!input) throw new Error(`Unexpected model tool: ${name}`);
  return { content: [{ type: "tool_use", name, input }] };
};

let server, base, browser;
const artifactDir = join(process.cwd(), "output", "completion-qa");
before(async () => {
  await mkdir(artifactDir, { recursive: true });
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = realFetch;
  await rm(dataDir, { recursive: true, force: true });
});
async function api(path, body) {
  const response = await fetch(base + path, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function finished(name = "Alex Rivera") {
  const { data: a } = await api("/api/assignments", { subjectName: name, company: "Studio", subjectRole: "Founder", language: "en" });
  const { data: i } = await api("/api/interviews", { assignmentId: a.id, mode: "text" });
  assert.equal(i.visibility, "private");
  await api(`/api/interviews/${i.id}/start`, {});
  const ended = await api(`/api/interviews/${i.id}/answer`, { text: raw });
  assert.equal(ended.data.interview.status, "finished");
  return i.id;
}
async function ready(id) {
  for (let n = 0; n < 80; n++) {
    const { data } = await api(`/api/interviews/${id}`);
    if (data.content) return data;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Content never completed");
}
async function pageFor(id, viewport = { width: 1200, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}/i/${id}`);
  return { page, context, errors };
}

test("consent gates generation, legacy records and private interviews stay off The Wall", async () => {
  const id = await finished();
  const beforeCount = generations;
  assert.equal((await api(`/api/interviews/${id}`)).data.content, undefined);
  assert.equal((await api(`/api/interviews/${id}/content`, {})).status, 409);
  assert.equal((await api(`/api/interviews/${id}/consent`, { visibility: "yes" })).status, 400);
  assert.equal(generations, beforeCount);
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  const result = await ready(id);
  assert.equal(result.rawTranscript.includes(raw), true);
  assert.equal(result.cleanTranscript.includes(cleaned), true);
  assert.equal(result.transcriptCleanup, "cleaned");
  assert.equal(result.turns.find(t => t.speaker === "subject").text, raw);
  const legacy = { ...result, id: "legacy", visibility: undefined, consentAt: undefined };
  store.putInterview(legacy);
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  assert.equal((await api("/api/wall")).data.stats.interviewsFinished, 0);
  const snapshot = JSON.parse(await readFile(join(dataDir, "store.json"), "utf8"));
  assert.equal(snapshot.interviews[id].visibility, "private");
  assert.ok(snapshot.interviews[id].consentAt);
  assert.equal((await api(`/api/interviews/${id}/start`, {})).status, 409);
  assert.equal((await api(`/api/interviews/${id}/answer`, { text: "late" })).status, 409);
});

test("private completion, reload, clipboard, PDF download, email and mobile layout", async () => {
  const id = await finished();
  const { page, context, errors } = await pageFor(id);
  await page.locator("#consent").waitFor({ state: "visible" });
  assert.equal(await page.locator("#end").isVisible(), false);
  await page.screenshot({ path: join(artifactDir, "consent-desktop.png"), fullPage: true });
  await page.locator("#choosePrivate").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#visibilityLabel").textContent(), "Private");
  assert.equal(await page.locator("#viewWall").isVisible(), false);
  await page.locator("#copySummary").click();
  await page.waitForFunction(() => document.getElementById("copySummary").textContent === "Copied");
  assert.equal(await page.locator("#copySummary").textContent(), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), (await api(`/api/interviews/${id}`)).data.summaryText);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#pdf").click();
  const download = await downloadPromise;
  await download.saveAs(join(artifactDir, "interview.pdf"));
  assert.equal((await readFile(join(artifactDir, "interview.pdf"))).subarray(0, 5).toString(), "%PDF-");
  await page.locator("#emailToggle").click();
  await page.locator("#summaryEmail").fill("reader@example.com");
  await page.locator("#sendEmail").click();
  assert.match(await page.locator("#emailStatus").textContent(), /Sending/);
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("Summary sent"));
  assert.match(sentEmails.at(-1).text, /KEY TAKEAWAYS/);
  assert.match(sentEmails.at(-1).text, /Private/);
  assert.deepEqual(sentEmails.at(-1).to, ["reader@example.com"]);
  await page.screenshot({ path: join(artifactDir, "results-desktop.png"), fullPage: true });
  await page.reload();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#consent").isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifactDir, "results-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("On the Record is explicit, persists, appears on Wall and can be made private", async () => {
  const id = await finished("Public interview");
  const { page, context, errors } = await pageFor(id, { width: 390, height: 844 });
  await page.locator("#chooseRecord").waitFor({ state: "visible" });
  await page.screenshot({ path: join(artifactDir, "consent-mobile.png"), fullPage: true });
  await page.locator("#chooseRecord").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal(await page.locator("#viewWall").isVisible(), true);
  const wall = (await api("/api/wall")).data;
  assert.deepEqual(wall.rows.map(r => r.interviewId), [id]);
  assert.equal(wall.stats.interviewsFinished, 1);
  await page.reload();
  await page.locator("#viewWall").waitFor({ state: "visible" });
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  assert.equal((await api("/api/wall")).data.rows.length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test("cleanup rejects invented facts, negations, missing numbers and preserves uncertain wording", async () => {
  assert.equal(preservesWords(raw, cleaned), true);
  assert.equal(preservesWords(raw, cleaned.replace("2024", "2025")), false);
  assert.equal(preservesWords("we did not move", "We did move."), false);
  assert.equal(preservesWords("I guess it cost 600", "It cost 600."), false);
  assert.equal(preservesWords("we we started um yesterday", "We started yesterday."), true);
  const readable = formatTranscriptText(raw);
  assert.match(readable, /^Yeah, so/);
  assert.match(readable, /2024\. And then/);
  assert.ok(!readable.includes(" um "));
  assert.equal(preservesWords(raw, readable), true);
  const interview = { turns: [{ speaker: "subject", text: raw }] };
  cleanupOverride = "We started in 2025.";
  await prepareTranscript({ subjectName: "Alex" }, interview);
  cleanupOverride = undefined;
  assert.equal(interview.transcriptCleanup, "fallback");
  assert.ok(interview.cleanTranscript.includes("2024"));
  assert.ok(!interview.cleanTranscript.includes("2025"));
});

test("generation failures recover without stale errors and concurrent requests share one job", async () => {
  const id = await finished();
  failGeneration = true;
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  assert.ok((await ready(id)).content.error);
  failGeneration = false;
  const count = generations;
  const results = await Promise.all([api(`/api/interviews/${id}/content?force=1`, {}), api(`/api/interviews/${id}/content?force=1`, {})]);
  assert.equal(generations, count + 1);
  assert.ok(results.every(r => r.status === 200 && !r.data.error));
  assert.equal((await ready(id)).content.error, undefined);
});

test("email validates addresses and exposes disabled, failure, success and rate limit states", async () => {
  const id = await finished();
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  await ready(id);
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "bad" })).status, 400);
  delete process.env.RESEND_API_KEY;
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "reader@example.com" })).status, 503);
  const { page, context, errors } = await pageFor(id);
  await page.locator("#endBar").waitFor({ state: "visible" });
  await page.locator("#emailToggle").click();
  assert.equal(await page.locator("#sendEmail").isDisabled(), true);
  assert.match(await page.locator("#emailStatus").textContent(), /isn’t set up/);
  process.env.RESEND_API_KEY = "test-only";
  await page.reload();
  await page.locator("#endBar").waitFor({ state: "visible" });
  await page.locator("#emailToggle").click();
  await page.locator("#summaryEmail").fill("reader@example.com");
  failEmail = true;
  await page.locator("#sendEmail").click();
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("not confirmed"));
  assert.equal(await page.locator("#sendEmail").isDisabled(), false);
  failEmail = false;
  await page.locator("#sendEmail").click();
  await page.waitForFunction(() => document.getElementById("emailStatus").textContent.includes("Summary sent"));
  assert.equal((await api(`/api/interviews/${id}/email`, { email: "reader@example.com" })).status, 429);
  assert.deepEqual(errors, []);
  await context.close();
});

test("empty early completion stays usable without waiting for a nonexistent story", async () => {
  const { data: i } = await api("/api/quickstart", {});
  assert.equal((await api(`/api/interviews/${i.id}/consent`, { visibility: "private" })).status, 400);
  await api(`/api/interviews/${i.id}/end`, {});
  const { page, context } = await pageFor(i.id);
  await page.locator("#choosePrivate").click();
  await page.waitForFunction(() => document.getElementById("writing").textContent.includes("Nothing was recorded"));
  assert.equal(await page.locator("#anotherInterview").isVisible(), true);
  assert.equal(await page.locator("#endBar").isVisible(), false);
  await context.close();
});

test("End early saves the current typed answer and failed consent can be retried", async () => {
  const { data: a } = await api("/api/assignments", { subjectName: "Early finish" });
  const { data: i } = await api("/api/interviews", { assignmentId: a.id, mode: "text" });
  const { page, context, errors } = await pageFor(i.id);
  await page.addInitScript(() => { window.speechSynthesis.cancel(); window.speechSynthesis.speak = utterance => utterance.onend?.(); });
  await page.route("**/api/tts", route => route.fulfill({ status: 204 }));
  await page.reload();
  await page.locator("#start").click();
  await page.waitForFunction(() => !document.getElementById("finish").disabled);
  await page.locator("#typedText").fill(raw);
  await page.locator("#finish").click();
  await page.locator("#consent").waitFor({ state: "visible" });
  assert.equal((await api(`/api/interviews/${i.id}`)).data.turns.at(-1).text, raw);
  await page.route("**/consent", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not save your choice." }) }), { times: 1 });
  await page.locator("#choosePrivate").click();
  await page.waitForFunction(() => document.getElementById("consentError").textContent.includes("Could not save"));
  assert.equal(await page.locator("#end").isVisible(), false);
  await page.locator("#choosePrivate").click();
  await page.locator("#endBar").waitFor({ state: "visible" });
  assert.equal((await api(`/api/interviews/${i.id}`)).data.visibility, "private");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw Error("Clipboard denied"); } }, configurable: true }));
  await page.locator("#copySummary").click();
  await page.waitForFunction(() => document.getElementById("actionStatus").textContent.includes("Clipboard denied"));
  assert.notEqual(await page.locator("#copySummary").textContent(), "Copied");
  await page.route("**/pdf", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "PDF unavailable" }) }));
  await page.locator("#pdf").click();
  await page.waitForFunction(() => document.getElementById("actionStatus").textContent.includes("PDF unavailable"));
  assert.equal(await page.locator("#pdf").isDisabled(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("long Spanish PDF wraps across pages", async () => {
  const id = await finished("José García");
  await api(`/api/interviews/${id}/consent`, { visibility: "private" });
  const i = await ready(id);
  const pdf = await interviewPdf({ ...i.assignment, language: "es" }, { ...i, cleanTranscript: "José: Empezamos en 2024. Aprendimos muchísimo durante los primeros tres meses.\n\n".repeat(100) }, { ...i.content, nail: "Una conversación sobre cómo empezar", summary: "Empezamos en 2024. Después de tres meses, cambiamos de dirección." });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(artifactDir, "long-spanish.pdf"), pdf);
  assert.ok(pdf.length > 5000);
});
