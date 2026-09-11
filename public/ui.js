export const $ = (id) => document.getElementById(id);
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error || "The request could not be completed. Please try again.";
    if (/authentication method|apiKey|ANTHROPIC_API_KEY/.test(message)) {
      throw new Error("The interviewer isn’t configured yet. Ask your editor to check the server setup, then try again.");
    }
    throw new Error(message);
  }
  return data;
}

const formats = [["blogDraft", "The story"], ["linkedinPost", "LinkedIn post"], ["instagramCaption", "Instagram caption"], ["podcastSegment", "Podcast segment"]];

export function contentMarkup(content) {
  let html = content.nail ? `<section class="result-section"><p class="eyebrow">THE HEART OF THE STORY</p><h2>${esc(content.nail)}</h2></section>` : "";
  html += formats.filter(([key]) => content[key]).map(([key, label]) => `<section class="result-section"><p class="eyebrow">READY TO WORK WITH</p><h2>${label}</h2><div class="prose">${esc(content[key])}</div></section>`).join("");
  if (content.pullQuotes?.length) html += `<section class="result-section"><h2>Moments worth keeping</h2>${content.pullQuotes.map((q) => `<blockquote class="pull-quote">“${esc(q.quote)}”${q.why ? `<footer>${esc(q.why)}</footer>` : ""}</blockquote>`).join("")}</section>`;
  if (content.xThread?.length) html += `<section class="result-section"><h2>X thread</h2>${content.xThread.map((post, i) => `<div class="story-card"><p class="eyebrow">${i + 1} / ${content.xThread.length}</p><p class="prose">${esc(post)}</p></div>`).join("")}</section>`;
  if (content.contextGap) html += `<section class="result-section"><h2>A question to carry forward</h2><div class="insight"><p>${esc(content.contextGap)}</p></div></section>`;
  if (content.corrections?.length) html += `<details class="result-section"><summary>Editorial corrections (${content.corrections.length})</summary>${content.corrections.map((c) => `<div class="correction"><strong>${esc(c.field)}</strong><p>Original claim: ${esc(c.claim)}</p><p>${esc(c.problem)}</p><p>Correction: ${esc(c.fix)}</p></div>`).join("")}</details>`;
  return html || '<p class="field-hint">No story content was returned for this interview.</p>';
}

export function contentText(content) {
  return [content.nail, ...formats.filter(([key]) => content[key]).map(([key, label]) => `${label}\n\n${content[key]}`),
    ...(content.pullQuotes || []).map((q) => `“${q.quote}”${q.why ? `\n${q.why}` : ""}`),
    ...(content.xThread || []), content.contextGap,
    ...(content.corrections || []).map((c) => `Editorial correction (${c.field})\n${c.claim}\n${c.problem}\n${c.fix}`),
  ].filter(Boolean).join("\n\n");
}
