import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { preflight } from "./anthropic.ts";
import { generateContent } from "./content.ts";
import { greeting, nextQuestion } from "./interviewer.ts";
import { id, store } from "./store.ts";
import { speak, ttsEnabled } from "./tts.ts";
import type { Assignment, Deliverable, Interview } from "./types.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(process.cwd(), "public")));

const PORT = Number(process.env.PORT || 8787);
const BASE = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const DEFAULT_DELIVERABLES: Deliverable[] = [
  "pull_quotes",
  "instagram_caption",
  "linkedin_post",
];

/* ------------------------------------------------------------------ */
/* assignments                                                         */
/* ------------------------------------------------------------------ */

app.post("/api/assignments", (req, res) => {
  const b = req.body ?? {};
  if (!b.subjectName || !b.company || !b.angle) {
    return res
      .status(400)
      .json({ error: "subjectName, company and angle are required." });
  }
  const assignment: Assignment = {
    id: id("asg"),
    createdAt: Date.now(),
    subjectName: b.subjectName,
    subjectRole: b.subjectRole,
    company: b.company,
    angle: b.angle,
    beats: Array.isArray(b.beats) && b.beats.length ? b.beats : defaultBeats(b.company),
    deliverables: Array.isArray(b.deliverables) && b.deliverables.length
      ? b.deliverables
      : DEFAULT_DELIVERABLES,
    durationMinutes: Number(b.durationMinutes) || 10,
    backgroundNotes: b.backgroundNotes,
  };
  store.putAssignment(assignment);
  res.json(assignment);
});

app.get("/api/assignments", (_req, res) => res.json(store.listAssignments()));

function defaultBeats(company: string) {
  return [
    `How ${company} started — the specific moment, not the summary`,
    "The hardest day, and what actually happened",
    "What customers say that surprises them",
    "What they wish people understood about the business",
    "What's next in the near term",
  ];
}

/* ------------------------------------------------------------------ */
/* interviews                                                          */
/* ------------------------------------------------------------------ */

app.post("/api/interviews", (req, res) => {
  const assignment = store.getAssignment(req.body?.assignmentId);
  if (!assignment) return res.status(404).json({ error: "No such assignment." });

  const interview: Interview = {
    id: id("int"),
    assignmentId: assignment.id,
    status: "waiting",
    turns: [],
    beatsCovered: Object.fromEntries(assignment.beats.map((b) => [b, false])),
  };
  store.putInterview(interview);
  res.json({ ...interview, url: `${BASE}/i/${interview.id}` });
});

app.get("/api/interviews/:iid", (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  const assignment = store.getAssignment(interview.assignmentId);
  res.json({
    ...interview,
    assignment,
    content: store.getContent(interview.id),
    url: `${BASE}/i/${interview.id}`,
    ttsEnabled: ttsEnabled(),
  });
});

/** Subject pressed Start. Returns the greeting and the opening question. */
app.post("/api/interviews/:iid/start", async (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  const assignment = store.getAssignment(interview.assignmentId)!;

  interview.status = "live";
  interview.startedAt = Date.now();
  interview.turns = [];
  store.putInterview(interview);

  try {
    const q = await nextQuestion(assignment, interview);
    interview.turns.push({
      speaker: "interviewer",
      text: q.question,
      at: 0,
      move: q.move,
      topic: q.topic,
      reasoning: q.reasoning,
    });
    store.putInterview(interview);
    res.json({ greeting: greeting(assignment), question: q, interview });
  } catch (err) {
    console.error("[start]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Subject finished speaking. Store it, decide the next move. */
app.post("/api/interviews/:iid/answer", async (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  const assignment = store.getAssignment(interview.assignmentId)!;
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Empty answer." });

  interview.turns.push({
    speaker: "subject",
    text,
    at: Date.now() - (interview.startedAt ?? Date.now()),
  });
  store.putInterview(interview);

  try {
    const q = await nextQuestion(assignment, interview);
    for (const beat of q.beats_now_covered) {
      if (beat in interview.beatsCovered) interview.beatsCovered[beat] = true;
    }
    interview.turns.push({
      speaker: "interviewer",
      text: q.question,
      at: Date.now() - (interview.startedAt ?? Date.now()),
      move: q.move,
      topic: q.topic,
      reasoning: q.reasoning,
    });
    if (q.should_end) {
      interview.status = "finished";
      interview.endedAt = Date.now();
    }
    store.putInterview(interview);
    res.json({ question: q, interview });
  } catch (err) {
    console.error("[answer]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/interviews/:iid/end", (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  interview.status = "finished";
  interview.endedAt = Date.now();
  store.putInterview(interview);
  res.json(interview);
});

/* ------------------------------------------------------------------ */
/* content                                                             */
/* ------------------------------------------------------------------ */

app.post("/api/interviews/:iid/content", async (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  const assignment = store.getAssignment(interview.assignmentId)!;
  if (interview.turns.filter((t) => t.speaker === "subject").length === 0) {
    return res.status(400).json({ error: "Nobody said anything yet." });
  }
  try {
    const content = await generateContent(assignment, interview);
    store.putContent(interview.id, content);
    res.json(content);
  } catch (err) {
    console.error("[content]", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ------------------------------------------------------------------ */
/* voice + misc                                                        */
/* ------------------------------------------------------------------ */

app.post("/api/tts", async (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 800);
  if (!text) return res.status(400).end();
  try {
    const audio = await speak(text);
    if (!audio) return res.status(204).end(); // browser falls back to built-in voice
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audio));
  } catch (err) {
    console.error("[tts]", err);
    res.status(204).end();
  }
});

app.get("/api/stats", (_req, res) => res.json(store.stats()));

app.get("/api/wall", (_req, res) => {
  // Everything the closing slide needs: who we talked to and what came out.
  const rows = store
    .listInterviews()
    .filter((i) => i.status === "finished")
    .map((i) => {
      const a = store.getAssignment(i.assignmentId);
      const c = store.getContent(i.id);
      return {
        interviewId: i.id,
        subject: a?.subjectName,
        company: a?.company,
        minutes: Math.round((((i.endedAt ?? 0) - (i.startedAt ?? 0)) / 60000) * 10) / 10,
        questions: i.turns.filter((t) => t.speaker === "interviewer").length,
        nail: c?.nail,
        topQuote: c?.pullQuotes?.[0]?.quote,
      };
    });
  res.json({ stats: store.stats(), rows });
});

app.get("/i/:iid", (_req, res) =>
  res.sendFile(join(process.cwd(), "public", "interview.html")),
);

app.listen(PORT, () => {
  console.log(`\n  Prologue Interviewer`);
  console.log(`  console   ${BASE}/`);
  console.log(`  voice tts ${ttsEnabled() ? "ElevenLabs" : "browser fallback (no key set)"}\n`);
  preflight();
});
