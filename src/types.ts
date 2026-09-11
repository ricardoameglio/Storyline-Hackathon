export type Deliverable =
  | "pull_quotes"
  | "linkedin_post"
  | "instagram_caption"
  | "blog_draft"
  | "podcast_segment"
  | "x_thread";

/** What an editor hands the interviewer before it goes out. */
export interface Assignment {
  id: string;
  createdAt: number;
  /** Who we're talking to. */
  subjectName: string;
  subjectRole?: string;
  /** The company / brand the story is about. */
  company: string;
  /** The editor's angle in one sentence. This is the spine of the interview. */
  angle: string;
  /** Things the editor needs on the record. The interviewer must land all of these. */
  beats: string[];
  deliverables: Deliverable[];
  /** Minutes. Default 10. */
  durationMinutes: number;
  /** Anything the interviewer should know going in. */
  backgroundNotes?: string;
}

export type Speaker = "interviewer" | "subject";

export interface Turn {
  speaker: Speaker;
  text: string;
  /** ms since interview start */
  at: number;
  /** Which beat this turn was working on, if any. */
  beat?: string;
  /** 1-3 word label for what this question is about. Used to catch circling. */
  topic?: string;
  /** Why the interviewer said what it said — surfaced in the UI, and it sells the demo. */
  reasoning?: string;
  move?: InterviewMove;
}

export type InterviewMove =
  | "open"
  | "follow_up"
  | "press_for_detail"
  | "next_beat"
  | "mirror"
  | "close";

export type InterviewStatus = "waiting" | "live" | "finished";

export interface Interview {
  id: string;
  assignmentId: string;
  status: InterviewStatus;
  startedAt?: number;
  endedAt?: number;
  turns: Turn[];
  /** beat -> covered */
  beatsCovered: Record<string, boolean>;
}

/** Something the copy claimed that the transcript does not actually support. */
export interface Correction {
  /** Which deliverable it was in, e.g. "linkedinPost". */
  field: string;
  /** The offending text, quoted. */
  claim: string;
  /** Why it is not supported. */
  problem: string;
  /** What it was changed to, or "cut". */
  fix: string;
}

export interface GeneratedContent {
  /** Unsupported claims caught and fixed before delivery. */
  corrections?: Correction[];
  nail?: string;
  contextGap?: string;
  pullQuotes?: { quote: string; why: string }[];
  linkedinPost?: string;
  instagramCaption?: string;
  xThread?: string[];
  blogDraft?: string;
  podcastSegment?: string;
}
