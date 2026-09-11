import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { preflight } from "./anthropic.ts";
import { generateContent } from "./content.ts";
import { greeting, intakeOpener, intakeQuestion, nextQuestion } from "./interviewer.ts";
import { id, store } from "./store.ts";
import { preflightTts, speak, ttsEnabled } from "./tts.ts";
import type { Assignment, Deliverable, Interview, Language } from "./types.ts";

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

/**
 * The moment the interview ends, start writing. Nobody should have to ask.
 *
 * The subject is still sitting there — if their post appears on screen before
 * they stand up, they say yes to publishing it. If it arrives tomorrow by
 * email, it never gets posted. Fire and forget; the room polls for it.
 */
function kickOffContent(interview: Interview) {
  if (store.getContent(interview.id)) return;
  const assignment = store.getAssignment(interview.assignmentId);
  if (!assignment) return;
  // Intake answers are not the interview. An abandoned handshake writes nothing.
  const said = interview.turns.filter(
    (t) => t.speaker === "subject" && (t.phase ?? "interview") === "interview",
  );
  if (said.length === 0) return;

  console.log(`[content] writing up ${interview.id}…`);
  generateContent(assignment, interview)
    .then((c) => {
      store.putContent(interview.id, c);
      console.log(`[content] ${interview.id} ready`);
    })
    .catch((err) => {
      // Record the failure. A blank screen with no explanation is worse than
      // an error — the subject is standing there waiting for something.
      console.error(`[content] ${interview.id} failed:`, err);
      store.putContent(interview.id, { error: (err as Error).message });
    });
}

/* ------------------------------------------------------------------ */
/* assignments                                                         */
/* ------------------------------------------------------------------ */

/** The only thing we truly need is somebody's name to greet them with. */
const DEFAULT_ANGLE =
  "Find the one specific story here worth telling — the moment it turned, the number nobody expects, the work people don't see.";
const DEFAULT_ANGLE_ES =
  "Encuentra la historia específica que vale la pena contar: el momento en que giró, el número que nadie espera, el trabajo que nadie ve.";

app.post("/api/assignments", (req, res) => {
  const b = req.body ?? {};
  if (!b.subjectName?.trim()) {
    return res.status(400).json({ error: "Who are we talking to?" });
  }
  const company = (b.company ?? "").trim();
  const language = lang(b.language);
  const assignment: Assignment = {
    id: id("asg"),
    createdAt: Date.now(),
    subjectName: b.subjectName.trim(),
    subjectRole: b.subjectRole,
    company,
    language,
    angle:
      (b.angle ?? "").trim() || (language === "es" ? DEFAULT_ANGLE_ES : DEFAULT_ANGLE),
    beats:
      Array.isArray(b.beats) && b.beats.length ? b.beats : defaultBeats(company, language),
    deliverables: Array.isArray(b.deliverables) && b.deliverables.length
      ? b.deliverables
      : DEFAULT_DELIVERABLES,
    durationMinutes: Number(b.durationMinutes) || 10,
    maxQuestions: Number(b.maxQuestions) > 0 ? Number(b.maxQuestions) : undefined,
    backgroundNotes: b.backgroundNotes,
  };
  store.putAssignment(assignment);
  res.json(assignment);
});

/**
 * Self-serve: no form at all. Creates an empty assignment and an interview that
 * opens in intake, so the interviewer asks who you are before it interviews you.
 * This is what you hand a stranger.
 */
app.post("/api/quickstart", (req, res) => {
  const b = req.body ?? {};
  const language = lang(b.language);
  const assignment: Assignment = {
    id: id("asg"),
    createdAt: Date.now(),
    subjectName: "",
    company: "",
    language,
    angle: language === "es" ? DEFAULT_ANGLE_ES : DEFAULT_ANGLE,
    beats: defaultBeats("", language),
    deliverables: DEFAULT_DELIVERABLES,
    durationMinutes: Number(b.durationMinutes) || 10,
    maxQuestions: Number(b.maxQuestions) > 0 ? Number(b.maxQuestions) : undefined,
  };
  store.putAssignment(assignment);

  const interview: Interview = {
    id: id("int"),
    assignmentId: assignment.id,
    status: "waiting",
    phase: "intake",
    mode: b.mode === "text" ? "text" : "voice",
    turns: [],
    beatsCovered: Object.fromEntries(assignment.beats.map((x) => [x, false])),
  };
  store.putInterview(interview);
  res.json({ ...interview, assignment, url: `${BASE}/i/${interview.id}` });
});

app.get("/api/assignments", (_req, res) => res.json(store.listAssignments()));

function defaultBeats(company: string, language?: Language) {
  if (language === "es") {
    const eso = company || "lo que hace";
    return [
      `Cómo empezó ${eso} — el momento específico, no el resumen`,
      "El día más difícil, y qué pasó exactamente",
      "Lo que le dice la gente que lo sorprende",
      `Lo que quisiera que la gente entendiera sobre ${eso}`,
      "Qué viene en el corto plazo",
    ];
  }
  const it = company || "what they do";
  return [
    `How ${it} started — the specific moment, not the summary`,
    "The hardest day, and what actually happened",
    "What other people say that surprises them",
    `What they wish people understood about ${it}`,
    "What's next in the near term",
  ];
}

const lang = (v: unknown): Language => (v === "es" ? "es" : "en");

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
    phase: "interview",
    mode: req.body?.mode === "text" ? "text" : "voice",
    turns: [],
    beatsCovered: Object.fromEntries(assignment.beats.map((b) => [b, false])),
  };
  store.putInterview(interview);
  res.json({ ...interview, url: `${BASE}/i/${interview.id}` });
});

/** The subject can switch between talking and typing at any point. */
app.post("/api/interviews/:iid/mode", (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  interview.mode = req.body?.mode === "text" ? "text" : "voice";
  store.putInterview(interview);
  res.json({ mode: interview.mode });
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

/** Anything the interviewer learned during intake lands on the assignment. */
function applyIntake(assignment: Assignment, c: Record<string, string | undefined>) {
  const hadNoCompany = !assignment.company;
  if (c.subjectName?.trim()) assignment.subjectName = c.subjectName.trim();
  if (c.subjectRole?.trim()) assignment.subjectRole = c.subjectRole.trim();
  if (c.company?.trim()) assignment.company = c.company.trim();
  if (c.angle?.trim()) assignment.angle = c.angle.trim();
  // Beats were written around "what they do" — now we know what that is.
  if (hadNoCompany && assignment.company)
    assignment.beats = defaultBeats(assignment.company, assignment.language);
  store.putAssignment(assignment);
}

/** Shape an intake step so the client can treat it like any other question. */
const asQuestion = (text: string, reasoning: string) => ({
  question: text,
  move: "open" as const,
  reasoning,
  topic: "intake",
  beats_now_covered: [] as string[],
  should_end: false,
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
    if (interview.phase === "intake") {
      const step = await intakeQuestion(interview, assignment.language);
      interview.turns.push({
        speaker: "interviewer",
        text: step.question,
        at: 0,
        phase: "intake",
        move: "open",
        topic: "intake",
        reasoning: step.reasoning,
      });
      store.putInterview(interview);
      return res.json({
        greeting: intakeOpener(assignment.language),
        question: asQuestion(step.question, step.reasoning),
        interview,
        assignment,
      });
    }

    const q = await nextQuestion(assignment, interview);
    interview.turns.push({
      speaker: "interviewer",
      text: q.question,
      at: 0,
      phase: "interview",
      move: q.move,
      topic: q.topic,
      reasoning: q.reasoning,
    });
    store.putInterview(interview);
    res.json({ greeting: greeting(assignment), question: q, interview, assignment });
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

  const at = Date.now() - (interview.startedAt ?? Date.now());
  const inIntake = (interview.phase ?? "interview") === "intake";
  interview.turns.push({ speaker: "subject", text, at, phase: inIntake ? "intake" : "interview" });
  store.putInterview(interview);

  try {
    if (inIntake) {
      const step = await intakeQuestion(interview, assignment.language);
      applyIntake(assignment, step.collected ?? {});
      interview.turns.push({
        speaker: "interviewer",
        text: step.question,
        at,
        phase: "intake",
        move: "open",
        topic: "intake",
        reasoning: step.reasoning,
      });

      if (!step.done) {
        store.putInterview(interview);
        return res.json({
          question: asQuestion(step.question, step.reasoning),
          interview,
          assignment,
        });
      }

      // Handoff: intake is over, the real interview starts on the same breath.
      interview.phase = "interview";
      store.putInterview(interview);
      const first = await nextQuestion(assignment, interview);
      interview.turns.push({
        speaker: "interviewer",
        text: first.question,
        at,
        phase: "interview",
        move: first.move,
        topic: first.topic,
        reasoning: first.reasoning,
      });
      store.putInterview(interview);
      return res.json({
        sayFirst: step.question,
        question: first,
        interview,
        assignment,
      });
    }

    const q = await nextQuestion(assignment, interview);
    for (const beat of q.beats_now_covered) {
      if (beat in interview.beatsCovered) interview.beatsCovered[beat] = true;
    }
    interview.turns.push({
      speaker: "interviewer",
      text: q.question,
      at,
      phase: "interview",
      move: q.move,
      topic: q.topic,
      reasoning: q.reasoning,
    });
    if (q.should_end) {
      interview.status = "finished";
      interview.endedAt = Date.now();
    }
    store.putInterview(interview);
    if (interview.status === "finished") kickOffContent(interview);
    res.json({ question: q, interview, assignment });
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
  kickOffContent(interview);
  res.json(interview);
});

/* ------------------------------------------------------------------ */
/* content                                                             */
/* ------------------------------------------------------------------ */

app.post("/api/interviews/:iid/content", async (req, res) => {
  const interview = store.getInterview(req.params.iid);
  if (!interview) return res.status(404).json({ error: "No such interview." });
  const assignment = store.getAssignment(interview.assignmentId)!;
  if (
    interview.turns.filter(
      (t) => t.speaker === "subject" && (t.phase ?? "interview") === "interview",
    ).length === 0
  ) {
    return res.status(400).json({ error: "Nobody said anything yet." });
  }
  // Already written — hand back the same copy the subject saw, unless asked to
  // redo it. The editor and the vendor must never be looking at two versions.
  // A failed attempt is not "already written"; always retry those.
  const existing = store.getContent(interview.id);
  if (existing && !existing.error && req.query.force !== "1") return res.json(existing);
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
    const audio = await speak(text, req.body?.language);
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
  preflightTts();
});
