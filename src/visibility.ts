import type { Interview } from "./types.ts";

/**
 * How many questions the subject was actually asked.
 *
 * Not every interviewer turn is a question. The intake handshake is not the
 * interview, and the closing "thank you for your time" is a sign-off, not a
 * question — counting either puts a number on The Wall that does not match the
 * transcript printed underneath it. A five-question interview must read five.
 *
 * The sign-off is the one turn that both closes and asks nothing; the closing
 * invitation ("anything you'd like to add?") is a real question and counts.
 */
export function questionsAsked(interview: Interview) {
  return interview.turns.filter(
    (t) =>
      t.speaker === "interviewer" &&
      (t.phase ?? "interview") === "interview" &&
      !(t.move === "close" && !/[?¿]/.test(t.text)),
  ).length;
}

export function isOnTheRecord(interview: Interview) {
  return interview.status === "finished" && interview.visibility === "on-the-record"
    && typeof interview.consentAt === "number" && Number.isFinite(interview.consentAt);
}

export function recordConsent(interview: Interview, visibility: unknown) {
  if (interview.status !== "finished") throw new Error("Finish the interview before choosing visibility.");
  if (visibility !== "private" && visibility !== "on-the-record") {
    throw new Error("Choose Private or On the Record.");
  }
  interview.visibility = visibility;
  interview.consentAt = Date.now();
}
