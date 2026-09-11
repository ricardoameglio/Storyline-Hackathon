import { $, esc, request } from "./ui.js";

let roomUrl = "";
let savedAssignment = null;
let wallSignature = "";

$("briefForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("go").disabled || !$("briefForm").reportValidity()) return;
  const body = {
    subjectName: $("subjectName").value.trim(), subjectRole: $("subjectRole").value.trim() || undefined,
    company: $("company").value.trim(), angle: $("angle").value.trim(), durationMinutes: Number($("durationMinutes").value),
  };
  if (!body.subjectName || !body.company || !body.angle) {
    $("formError").textContent = "Please add a name, business, and story assignment.";
    return;
  }
  $("go").disabled = true;
  $("go").textContent = "Creating your room…";
  $("formError").textContent = "";
  $("out").hidden = true;
  try {
    const signature = JSON.stringify(body);
    // Reuse a successful assignment if only room creation failed.
    if (savedAssignment?.signature !== signature) savedAssignment = { signature, data: await request("/api/assignments", body) };
    const interview = await request("/api/interviews", { assignmentId: savedAssignment.data.id });
    roomUrl = interview.url;
    const url = new URL(roomUrl, location.origin);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("The server returned an invalid room link.");
    $("roomLink").href = url.href;
    $("roomLink").textContent = url.href;
    url.searchParams.set("operator", "1");
    $("operatorLink").href = url.href;
    $("shareStatus").textContent = "Room created. Share the link or scan the QR code.";
    $("out").hidden = false;
    $("qr").replaceChildren();
    if (window.QRCode) {
      try { new window.QRCode($("qr"), { text: roomUrl, width: 120, height: 120, colorDark: "#24231f", colorLight: "#fffdf9" }); }
      catch { $("shareStatus").textContent = "Room created. QR code unavailable; share the link above."; }
    }
    $("roomLink").focus();
    savedAssignment = null;
  } catch (error) { $("formError").textContent = error.message; }
  finally { $("go").disabled = false; $("go").textContent = "Create interview room ↗"; }
});

$("copyLink").onclick = async () => {
  try { await navigator.clipboard.writeText(roomUrl); $("shareStatus").textContent = "Link copied. Ready to share."; }
  catch { $("shareStatus").textContent = "Copy unavailable. Select and copy the room link above."; }
};

async function wall() {
  try {
    const data = await request("/api/wall");
    $("wallStatus").textContent = "Updates every few seconds";
    const signature = JSON.stringify(data);
    if (signature === wallSignature) return;
    wallSignature = signature;
    $("stats").innerHTML = [["conversations completed", data.stats.interviewsFinished], ["minutes on the record", data.stats.minutesOnTheRecord], ["questions explored", data.stats.questionsAsked]]
      .map(([label, value]) => `<div class="stat"><b>${esc(value)}</b><span>${label}</span></div>`).join("");
    $("wall").innerHTML = data.rows.length ? data.rows.map((row) => `<article class="story-card"><p class="eyebrow">${esc(row.company)}</p><h3>${esc(row.subject)}</h3><p class="meta">${esc(row.minutes)} minutes · ${esc(row.questions)} questions</p>${row.nail ? `<p>${esc(row.nail)}</p>` : ""}${row.topQuote ? `<blockquote>“${esc(row.topQuote)}”</blockquote>` : '<p class="field-hint">Conversation complete. Ready to find the story.</p>'}<a class="text-link" href="/i/${encodeURIComponent(row.interviewId)}?operator=1">${row.nail || row.topQuote ? "Read the story" : "Open & generate story"} ↗</a></article>`).join("")
      : '<div class="empty"><div class="empty-symbol" aria-hidden="true">“</div><h3>Your first story is waiting to happen.</h3><p>Completed interviews will find a home here. Start with a brief above.</p></div>';
  } catch { $("wallStatus").textContent = "Collection unavailable. Reconnecting in a few seconds…"; }
}
wall();
setInterval(wall, 5000);
