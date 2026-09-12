import type { Assignment, GeneratedContent, Interview } from "./types.ts";
import { isOnTheRecord } from "./visibility.ts";

export function resultSections(a: Assignment, i: Interview, c: GeneratedContent) {
  const es = a.language === "es";
  return [
    { title: es ? "RESUMEN" : "SUMMARY", text: c.summary },
    { title: es ? "IDEAS CLAVE" : "KEY TAKEAWAYS", text: c.keyTakeaways?.map((s, n) => `${String(n + 1).padStart(2, "0")}  ${s}`).join("\n\n") },
    { title: es ? "MOMENTOS PARA RECORDAR" : "MOMENTS WORTH KEEPING", text: c.pullQuotes?.map(q => `“${q.quote}”`).join("\n\n") },
    { title: es ? "HISTORIA" : "STORY", text: c.blogDraft || c.linkedinPost || c.instagramCaption },
    { title: es ? "VISIBILIDAD" : "VISIBILITY", text: isOnTheRecord(i) ? (es ? "En el archivo público" : "On the Record") : (es ? "Privada" : "Private") },
  ].filter(s => s.text);
}

export function resultMetadata(a: Assignment, i: Interview) {
  const es = a.language === "es";
  const date = i.endedAt || i.startedAt;
  const minutes = Math.max(0, Math.round(((i.endedAt || 0) - (i.startedAt || i.endedAt || 0)) / 60000));
  return [a.subjectName || (es ? "Entrevista" : "Interview"), [a.subjectRole, a.company].filter(Boolean).join(" / "),
    date ? new Intl.DateTimeFormat(es ? "es" : "en", { dateStyle: "long", timeZone: "UTC" }).format(date) + " (UTC)" : "",
    minutes ? `${minutes} min` : "< 1 min",
  ].filter(Boolean);
}

export function summaryText(a: Assignment, i: Interview, c: GeneratedContent, url?: string) {
  return ["PROLOGUE", ...resultMetadata(a, i), c.nail,
    ...resultSections(a, i, c).map(s => `${s.title}\n${s.text}`), url,
  ].filter(Boolean).join("\n\n");
}
