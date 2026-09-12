import type { Interview } from "./types.ts";

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
