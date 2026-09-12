import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Assignment, GeneratedContent, Interview } from "./types.ts";
import { isOnTheRecord } from "./visibility.ts";

/**
 * Hackathon-grade persistence: in memory, mirrored to a JSON file so a
 * server restart at 2am doesn't lose the interviews you already ran.
 */
const DATA_DIR = process.env.PROLOGUE_DATA_DIR || join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "store.json");

interface Snapshot {
  assignments: Record<string, Assignment>;
  interviews: Record<string, Interview>;
  content: Record<string, GeneratedContent>;
}

const empty: Snapshot = { assignments: {}, interviews: {}, content: {} };

function load(): Snapshot {
  try {
    if (existsSync(DATA_FILE)) {
      return { ...empty, ...JSON.parse(readFileSync(DATA_FILE, "utf8")) };
    }
  } catch (err) {
    console.error("[store] could not read snapshot, starting fresh:", err);
  }
  return structuredClone(empty);
}

const db = load();

function flush() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("[store] could not write snapshot:", err);
  }
}

export function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export const store = {
  putAssignment(a: Assignment) {
    db.assignments[a.id] = a;
    flush();
    return a;
  },
  getAssignment(assignmentId: string) {
    return db.assignments[assignmentId];
  },
  listAssignments() {
    return Object.values(db.assignments).sort((a, b) => b.createdAt - a.createdAt);
  },

  putInterview(i: Interview) {
    i.visibility ??= "private";
    db.interviews[i.id] = i;
    flush();
    return i;
  },
  getInterview(interviewId: string) {
    return db.interviews[interviewId];
  },
  listInterviews() {
    return Object.values(db.interviews);
  },
  interviewsForAssignment(assignmentId: string) {
    return Object.values(db.interviews).filter((i) => i.assignmentId === assignmentId);
  },

  putContent(interviewId: string, c: GeneratedContent) {
    db.content[interviewId] = c;
    flush();
    return db.content[interviewId];
  },
  getContent(interviewId: string) {
    return db.content[interviewId];
  },

  /** Demo stat: "N vendors interviewed at Mashup last night." */
  stats(publicOnly = false) {
    const interviews = Object.values(db.interviews).filter((i) => !publicOnly || isOnTheRecord(i));
    const finished = interviews.filter((i) => i.status === "finished");
    const minutes = finished.reduce(
      (sum, i) => sum + ((i.endedAt ?? 0) - (i.startedAt ?? 0)) / 60000,
      0,
    );
    return {
      assignments: publicOnly ? new Set(interviews.map((i) => i.assignmentId)).size : Object.keys(db.assignments).length,
      interviewsStarted: interviews.length,
      interviewsFinished: finished.length,
      minutesOnTheRecord: Math.round(minutes),
      questionsAsked: interviews.reduce(
        (n, i) => n + i.turns.filter((t) => t.speaker === "interviewer").length,
        0,
      ),
    };
  },
};
