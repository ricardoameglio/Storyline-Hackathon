const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let busy = false;
let roomUrl = "";
let pendingAssignment = null;
let wallSignature = "";

function options() {
  return {
    durationMinutes: Number($("durationMinutes").value),
    maxQuestions: Number($("maxQuestions").value) || undefined,
    language: $("language").value,
  };
}

function validOptions() {
  return ["durationMinutes", "maxQuestions", "language"].every((id) => $(id).reportValidity());
}

async function post(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Couldn’t create the room. Please try again.");
  return data;
}

async function createRoom(selfServe) {
  if (busy) return;
  $("error").textContent = "";
  if (!validOptions()) return;
  if (!selfServe && !$("briefForm").reportValidity()) return;
  if (!selfServe && !$("subjectName").value.trim()) {
    $("error").textContent = "Add the name of the person you’d like to interview.";
    $("subjectName").focus();
    return;
  }
  busy = true;
  $("go").disabled = $("quick").disabled = true;
  $(selfServe ? "quick" : "go").textContent = "Creating your room…";
  $("requestStatus").textContent = "Getting your interview room ready…";
  try {
    let interview;
    if (selfServe) interview = await post("/api/quickstart", options());
    else {
      const body = {
        subjectName: $("subjectName").value.trim(), subjectRole: $("subjectRole").value.trim() || undefined,
        company: $("company").value.trim(), angle: $("angle").value.trim(), ...options(),
      };
      const signature = JSON.stringify(body);
      // Keep a successful assignment if room creation fails; retry without duplicating it.
      if (pendingAssignment?.signature !== signature) pendingAssignment = { signature, data: await post("/api/assignments", body) };
      interview = await post("/api/interviews", { assignmentId: pendingAssignment.data.id });
    }
    const url = new URL(interview.url, location.origin);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("The server returned an invalid room link.");
    roomUrl = url.href;
    $("roomLink").href = roomUrl;
    $("roomLink").textContent = roomUrl;
    url.searchParams.set("operator", "1");
    $("operatorLink").href = url.href;
    $("roomTitle").textContent = selfServe ? "Your self-serve room is ready." : "Your conversation starts here.";
    $("out").hidden = false;
    $("qr").replaceChildren();
    $("shareStatus").textContent = selfServe ? "Share the link. The interviewer will collect your guest’s details." : "Share the link with your interviewee, or scan the QR code.";
    if (window.QRCode) {
      try { new window.QRCode($("qr"), { text: roomUrl, width: 120, height: 120, colorDark: "#24231f", colorLight: "#fffdf9" }); }
      catch { $("shareStatus").textContent += " QR unavailable; the link still works."; }
    } else $("shareStatus").textContent += " QR unavailable; the link still works.";
    $("requestStatus").textContent = "Room created.";
    $("roomLink").focus();
    if (!selfServe) pendingAssignment = null;
  } catch (error) {
    $("requestStatus").textContent = "";
    $("error").textContent = error instanceof TypeError ? "Couldn’t connect to the server. Your brief is still here; check your connection and try again." : error.message;
  } finally {
    busy = false;
    $("go").disabled = $("quick").disabled = false;
    $("go").textContent = "Create interview room ↗";
    $("quick").textContent = "Open a self-serve room ↗";
  }
}

$("briefForm").addEventListener("submit", (event) => { event.preventDefault(); createRoom(false); });
$("quick").onclick = () => createRoom(true);
$("copyLink").onclick = async () => {
  try { await navigator.clipboard.writeText(roomUrl); $("shareStatus").textContent = "Link copied. Ready to share."; }
  catch { $("shareStatus").textContent = "Copy unavailable. Select and copy the room link above."; }
};

async function wall() {
  try {
    const response = await fetch("/api/wall");
    if (!response.ok) throw new Error("Collection unavailable");
    const data = await response.json();
    $("wallStatus").textContent = "Updates every few seconds";
    const signature = JSON.stringify(data);
    if (signature === wallSignature) return;
    wallSignature = signature;
    $("stats").innerHTML = [["conversations completed", data.stats.interviewsFinished], ["minutes on the record", data.stats.minutesOnTheRecord], ["questions explored", data.stats.questionsAsked]]
      .map(([label, value]) => `<div class="stat"><b>${esc(value)}</b><span>${label}</span></div>`).join("");
    $("wall").innerHTML = data.rows.length ? data.rows.map((row) => `<article class="story-card"><p class="eyebrow">${esc(row.company)}</p><h3>${esc(row.subject)}</h3><p class="meta">${esc(row.minutes)} minutes · ${esc(row.questions)} questions</p>${row.nail ? `<p>${esc(row.nail)}</p>` : ""}${row.topQuote ? `<blockquote>“${esc(row.topQuote)}”</blockquote>` : '<p class="hint">Conversation complete. A story worth exploring.</p>'}</article>`).join("")
      : '<div class="empty"><h3>Your first story is waiting to happen.</h3><p>Completed interviews will find a home here. Start with a brief or a self-serve room.</p></div>';
  } catch { $("wallStatus").textContent = "Collection unavailable. Reconnecting in a few seconds…"; }
}
wall();
setInterval(wall, 5000);
