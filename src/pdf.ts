import PDFDocument from "pdfkit";
import { resultMetadata, resultSections } from "./results.ts";
import type { Assignment, GeneratedContent, Interview } from "./types.ts";

/** Server-side PDF, with automatic wrapping and page breaks for long interviews. */
export function interviewPdf(a: Assignment, i: Interview, c: GeneratedContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54, bufferPages: true,
      info: { Title: c.nail || `Interview with ${a.subjectName}`, Author: "Prologue" } });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    /**
     * pdfkit's built-in fonts cover WinAnsi, which is most of what an editor
     * writes: em and en dashes, curly quotes, the ellipsis, the euro, accents.
     * Flattening those to ASCII made a product that sells "publishable copy"
     * print like a terminal, so only the genuinely unsupported characters are
     * swapped \u2014 each of these was rendered and checked, because pdfkit does not
     * throw on a missing glyph, it quietly prints the wrong one (U+2011 came out
     * as a space, U+202F as a slash, U+2212 as a double quote).
     */
    const text = (value: string) =>
      value
        .normalize("NFC")
        .replace(/\u2011/g, "-")
        .replace(/\u2212/g, "-")
        .replace(/\u202f/g, " ")
        .replace(/\u2032/g, "'");
    doc.fillColor("#656B60").font("Helvetica-Bold").fontSize(10).text("PROLOGUE", { characterSpacing: 2 });
    doc.moveDown(1.8);
    doc.fillColor("#282B25").font("Times-Roman").fontSize(27).text(text(c.nail || (a.language === "es" ? "Tu entrevista" : "Your interview")));
    doc.moveDown(.6);
    doc.font("Helvetica").fontSize(10).fillColor("#656B60").text(text(resultMetadata(a, i).join("\n")), { lineGap: 4 });
    doc.moveDown(2);
    const sections = [...resultSections(a, i, c),
      { title: a.language === "es" ? "TRANSCRIPCIÓN" : "CLEAN TRANSCRIPT", text: i.cleanTranscript || i.rawTranscript }];
    for (const section of sections) {
      if (!section.text) continue;
      if (doc.y > doc.page.height - 150) doc.addPage();
      doc.fillColor("#656B60").font("Helvetica-Bold").fontSize(9).text(section.title, { characterSpacing: 1 });
      doc.moveDown(.8);
      doc.fillColor("#282B25").font("Helvetica").fontSize(11).text(text(section.text), { lineGap: 5 });
      doc.moveDown(1.8);
    }
    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page++) {
      doc.switchToPage(page);
      doc.font("Helvetica").fontSize(8).fillColor("#656B60")
        .text(`PROLOGUE  /  ${page + 1} - ${pages.count}`, 54, doc.page.height - 35, { lineBreak: false });
    }
    doc.end();
  });
}
