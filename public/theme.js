/* Runs before styles paint; shared by the setup and interview pages. */
(() => {
  const key = "prologue-theme";
  const valid = value => ["light", "dark", "system"].includes(value);
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let choice = "system";
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) choice = saved;
  } catch { /* Storage can be unavailable in private or restricted contexts. */ }
  function apply() {
    document.documentElement.dataset.theme = choice === "system"
      ? (system.matches ? "dark" : "light") : choice;
    const control = document.getElementById("themeChoice");
    if (control) control.value = choice;
  }
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    choice = valid(event.newValue) ? event.newValue : "system";
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.getElementById("themeChoice")?.addEventListener("change", event => {
      choice = valid(event.target.value) ? event.target.value : "system";
      try { localStorage.setItem(key, choice); } catch { /* Keep theme usable without persistence. */ }
      apply();
    });
  });
})();
