import { createHash } from "node:crypto";
import { summaryText } from "./results.ts";
import type { Assignment, GeneratedContent, Interview } from "./types.ts";

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendSummaryEmail(to: string, a: Assignment, i: Interview, c: GeneratedContent, url: string) {
  if (!emailEnabled()) throw new Error("Email is not configured. Copy the summary or download the PDF instead.");
  const body = {
    from: process.env.EMAIL_FROM,
    to: [to],
    subject: `Prologue: ${a.subjectName || "Your interview"}`.replace(/[\r\n]/g, " ").slice(0, 200),
    text: summaryText(a, i, c, url),
  };
  // Retrying an uncertain send will not deliver a duplicate within Resend's window.
  const key = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("The email service could not send your summary. Please try again.");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error("The email service did not confirm the send. Please try again.");
  return result.id;
}
