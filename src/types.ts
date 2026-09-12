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
  /** Hard ceiling on questions. For people who say "I've got five minutes". */
  maxQuestions?: number;
  /** Interview and deliverables run in this language. Default English. */
  language?: Language;
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
  /** Intake turns are kept for the record but stay out of the interview transcript. */
  phase?: "intake" | "interview";
}

export type InterviewMove =
  | "open"
  | "follow_up"
  | "press_for_detail"
  | "next_beat"
  | "mirror"
  | "close";

export type InterviewStatus = "waiting" | "live" | "finished";

/** How the subject answers. Not everyone wants to talk out loud in a food hall. */
export type InterviewMode = "voice" | "text";

/** The language the whole thing runs in — questions, voice, and the copy. */
export type Language = "en" | "es";

/**
 * "intake" is the interviewer asking who you are before it interviews you —
 * the form, but conversational. It ends as soon as it has a name.
 */
export type InterviewPhase = "intake" | "interview";

export interface Interview {
  id: string;
  assignmentId: string;
  status: InterviewStatus;
  mode?: InterviewMode;
  phase?: InterviewPhase;
  startedAt?: number;
  endedAt?: number;
  /** Missing consent on older records is always private. */
  visibility?: "private" | "on-the-record";
  consentAt?: number;
  /**
   * Set when the screener ended it. Such an interview is forced private, never
   * written up, and never reaches The Wall.
   */
  endedReason?: "screened";
  rawTranscript?: string;
  cleanTranscript?: string;
  transcriptCleanup?: "cleaned" | "fallback";
  turns: Turn[];
  /** beat -> covered */
  beatsCovered: Record<string, boolean>;
  /**
   * Beats whose premise this person killed — a student has no customers, a shop
   * that opened today has no hardest year. Dropped, and never asked again.
   */
  beatsDropped?: Record<string, boolean>;
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
  /** Set when writing failed, so the room can say so instead of showing nothing. */
  error?: string;
  /** Unsupported claims caught and fixed before delivery. */
  corrections?: Correction[];
  /** Plain recap of what the conversation actually covered. */
  summary?: string;
  keyTakeaways?: string[];
  nail?: string;
  contextGap?: string;
  pullQuotes?: { quote: string; why: string }[];
  linkedinPost?: string;
  instagramCaption?: string;
  xThread?: string[];
  blogDraft?: string;
  podcastSegment?: string;
}
