#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * The editor's desk, inside Claude.
 *
 * Claude does not conduct the interview — a ten-minute live voice conversation
 * needs sub-second turns. Claude does what an editor does: hands out the
 * assignment, watches the interview come in, and takes delivery of the copy.
 */

const API = process.env.API_BASE || process.env.PUBLIC_BASE_URL || "http://localhost:8787";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(body?.error || `${res.status} from ${path}`);
  }
  return body;
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

const server = new McpServer({
  name: "prologue-interviewer",
  version: "0.1.0",
});

server.tool(
  "create_assignment",
  "Brief the interviewer before it goes out. Give it who to talk to, the angle, and what you need on the record. Returns an assignment id.",
  {
    subjectName: z.string().describe("Who is being interviewed."),
    company: z.string().describe("The business or brand the story is about."),
    angle: z.string().describe("The editorial angle, in one sentence."),
    subjectRole: z.string().optional().describe("Their role, e.g. 'owner'."),
    beats: z
      .array(z.string())
      .optional()
      .describe("What must be on the record. Omit for sensible defaults."),
    deliverables: z
      .array(
        z.enum([
          "pull_quotes",
          "linkedin_post",
          "instagram_caption",
          "blog_draft",
          "podcast_segment",
          "x_thread",
        ]),
      )
      .optional()
      .describe("What to produce afterwards."),
    durationMinutes: z.number().optional().describe("Interview length. Default 10."),
    backgroundNotes: z.string().optional().describe("Anything the interviewer should know going in."),
  },
  async (args) => {
    const a = await api("/api/assignments", {
      method: "POST",
      body: JSON.stringify(args),
    });
    return ok(
      [
        `Assignment ${a.id} created.`,
        `Subject: ${a.subjectName}${a.subjectRole ? `, ${a.subjectRole}` : ""} — ${a.company}`,
        `Angle: ${a.angle}`,
        `Length: ${a.durationMinutes} min`,
        ``,
        `Beats:`,
        ...a.beats.map((b: string) => `  - ${b}`),
        ``,
        `Next: start_interview with assignmentId "${a.id}" to get the link you hand them.`,
      ].join("\n"),
    );
  },
);

server.tool(
  "start_interview",
  "Open an interview room for an assignment. Returns a link — hand it to the person, they press start and talk. Nothing else is needed from you.",
  { assignmentId: z.string() },
  async ({ assignmentId }) => {
    const i = await api("/api/interviews", {
      method: "POST",
      body: JSON.stringify({ assignmentId }),
    });
    return ok(
      `Interview ${i.id} is open.\n\nSend them this link:\n${i.url}\n\nCheck in with interview_status when they're done.`,
    );
  },
);

server.tool(
  "interview_status",
  "How is the interview going? Returns status, elapsed time, how many beats have landed, and the last few exchanges.",
  { interviewId: z.string() },
  async ({ interviewId }) => {
    const i = await api(`/api/interviews/${interviewId}`);
    const covered = Object.entries(i.beatsCovered ?? {});
    const done = covered.filter(([, v]) => v).length;
    const mins = i.startedAt
      ? ((i.endedAt ?? Date.now()) - i.startedAt) / 60000
      : 0;
    const tail = (i.turns ?? []).slice(-6);
    return ok(
      [
        `Status: ${i.status}  ·  ${mins.toFixed(1)} min  ·  beats ${done}/${covered.length}`,
        ``,
        ...covered.map(([b, v]) => `  [${v ? "x" : " "}] ${b}`),
        ``,
        `Last exchanges:`,
        ...tail.map(
          (t: any) =>
            `  ${t.speaker === "interviewer" ? "Q" : "A"}: ${t.text}` +
            (t.reasoning ? `\n      (${t.move}: ${t.reasoning})` : ""),
        ),
      ].join("\n"),
    );
  },
);

server.tool(
  "get_transcript",
  "The full transcript, with the interviewer's reasoning for each question.",
  { interviewId: z.string() },
  async ({ interviewId }) => {
    const i = await api(`/api/interviews/${interviewId}`);
    const lines = (i.turns ?? []).map((t: any) =>
      t.speaker === "interviewer"
        ? `INTERVIEWER [${t.move}]: ${t.text}${t.reasoning ? `\n   ↳ ${t.reasoning}` : ""}`
        : `${(i.assignment?.subjectName ?? "SUBJECT").toUpperCase()}: ${t.text}`,
    );
    return ok(lines.join("\n\n") || "Nothing on the record yet.");
  },
);

server.tool(
  "generate_content",
  "Turn a finished interview into publishable work: the context gap, the Nail, verbatim pull quotes, and whichever deliverables the assignment asked for.",
  { interviewId: z.string() },
  async ({ interviewId }) => {
    const c = await api(`/api/interviews/${interviewId}/content`, { method: "POST" });
    const out: string[] = [];
    if (c.summary) out.push(`SUMMARY\n${c.summary}`);
    if (c.contextGap) out.push(`CONTEXT GAP\n${c.contextGap}`);
    if (c.nail) out.push(`THE NAIL\n${c.nail}`);
    if (c.pullQuotes?.length) {
      out.push(
        `PULL QUOTES\n` +
          c.pullQuotes
            .map((q: any) => `  "${q.quote}"\n    — ${q.why}`)
            .join("\n\n"),
      );
    }
    if (c.instagramCaption) out.push(`INSTAGRAM\n${c.instagramCaption}`);
    if (c.linkedinPost) out.push(`LINKEDIN\n${c.linkedinPost}`);
    if (c.xThread?.length)
      out.push(`X THREAD\n` + c.xThread.map((p: string, n: number) => `${n + 1}. ${p}`).join("\n\n"));
    if (c.blogDraft) out.push(`BLOG DRAFT\n${c.blogDraft}`);
    if (c.podcastSegment) out.push(`PODCAST SEGMENT\n${c.podcastSegment}`);
    if (c.corrections?.length) {
      out.push(
        `FACT-CHECK — ${c.corrections.length} unsupported claim${
          c.corrections.length === 1 ? "" : "s"
        } caught and fixed before delivery\n` +
          c.corrections
            .map(
              (x: any) =>
                `  [${x.field}] "${x.claim}"\n    problem: ${x.problem}\n    fix: ${x.fix}`,
            )
            .join("\n\n"),
      );
    } else if (c.corrections) {
      out.push("FACT-CHECK\nEvery claim traced back to the transcript. Nothing to fix.");
    }
    return ok(out.join("\n\n———\n\n"));
  },
);

server.tool(
  "the_wall",
  "Every finished interview with its Nail and best quote, plus running totals. This is the proof slide.",
  {},
  async () => {
    const w = await api("/api/wall");
    const s = w.stats;
    return ok(
      [
        `${s.interviewsFinished} interviews finished · ${s.minutesOnTheRecord} minutes on the record · ${s.questionsAsked} questions asked`,
        ``,
        ...w.rows.map(
          (r: any) =>
            `${r.subject} — ${r.company} (${r.minutes} min, ${r.questions} questions)\n` +
            `  Nail: ${r.nail ?? "—"}\n` +
            `  "${r.topQuote ?? "—"}"`,
        ),
      ].join("\n"),
    );
  },
);

await server.connect(new StdioServerTransport());
