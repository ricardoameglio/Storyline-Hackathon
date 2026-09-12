/* Styled, keyboard-accessible menus backed by the existing form selects. */
(() => {
  function init() {
    let closeCurrent = () => {};
    const refresh = [];
    for (const select of document.querySelectorAll("select")) {
      const themeIcons = select.id === "themeChoice" ? { system: "⚙️", light: "☀️", dark: "🌙" } : null;
      function renderLabel(container, option) {
        if (!themeIcons) { container.textContent = option?.textContent || "Choose"; return; }
        const icon = document.createElement("span");
        icon.className = "theme-option-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = themeIcons[option?.value] || "";
        const text = document.createElement("span");
        text.className = "theme-option-label";
        text.textContent = option?.textContent || "Choose";
        container.replaceChildren(icon, text);
      }
      const label = select.labels?.[0];
      const name = label ? [...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ").trim() : select.id;
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.id = `${select.id}-trigger`;
      trigger.className = "select-trigger";
      trigger.setAttribute("role", "combobox");
      trigger.setAttribute("aria-label", name);
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      const value = document.createElement("span");
      value.className = "select-value";
      const arrow = document.createElement("span");
      arrow.className = "select-arrow";
      arrow.setAttribute("aria-hidden", "true");
      trigger.append(value, arrow);
      const menu = document.createElement("div");
      menu.id = `${select.id}-options`;
      menu.className = "select-menu";
      if (themeIcons) menu.classList.add("theme-menu");
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", name);
      menu.hidden = true;
      document.body.append(menu);
      trigger.setAttribute("aria-controls", menu.id);
      select.after(trigger);
      select.hidden = true;
      if (label) label.htmlFor = trigger.id;
      let active = 0;
      let search = "";
      let searchTimer;
      const options = [...select.options];
      const items = options.map((option, index) => {
        const item = document.createElement("div");
        item.id = `${select.id}-option-${index}`;
        item.className = "select-option";
        item.setAttribute("role", "option");
        renderLabel(item, option);
        if (themeIcons) item.setAttribute("aria-label", option.textContent);
        item.setAttribute("aria-disabled", String(option.disabled));
        item.addEventListener("pointerdown", event => event.preventDefault());
        item.addEventListener("click", () => choose(index));
        menu.append(item);
        return item;
      });
      function sync() {
        renderLabel(value, select.selectedOptions[0]);
        trigger.disabled = select.disabled;
        items.forEach((item, index) => item.setAttribute("aria-selected", String(index === select.selectedIndex)));
      }
      function position() {
        if (menu.hidden) return;
        const rect = trigger.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0;
        const left = viewport?.offsetLeft || 0;
        const height = viewport?.height || innerHeight;
        const width = viewport?.width || innerWidth;
        const below = top + height - rect.bottom - 12;
        const above = rect.top - top - 12;
        const goUp = below < Math.min(menu.scrollHeight, 240) && above > below;
        menu.style.width = `${Math.min(rect.width, width - 16)}px`;
        menu.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - menu.offsetWidth - 8))}px`;
        menu.style.maxHeight = `${Math.max(0, Math.min(height - 16, 280, Math.max(44, goUp ? above : below)))}px`;
        const preferredTop = goUp ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6;
        menu.style.top = `${Math.max(top + 8, Math.min(preferredTop, top + height - menu.offsetHeight - 8))}px`;
      }
      function highlight(index) {
        active = index;
        items.forEach((item, i) => item.classList.toggle("active", i === index));
        trigger.setAttribute("aria-activedescendant", items[index].id);
        items[index].scrollIntoView({ block: "nearest" });
      }
      function close() {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        trigger.removeAttribute("aria-activedescendant");
        search = "";
        clearTimeout(searchTimer);
      }
      function open() {
        if (trigger.disabled) return;
        closeCurrent();
        closeCurrent = close;
        sync();
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        position();
        highlight(Math.max(0, select.selectedIndex));
      }
      function choose(index) {
        if (options[index].disabled) return;
        select.selectedIndex = index;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
        trigger.focus();
      }
      function move(delta) {
        let index = active;
        for (let n = 0; n < options.length; n++) {
          index = (index + delta + options.length) % options.length;
          if (!options[index].disabled) return highlight(index);
        }
      }
      trigger.addEventListener("click", () => menu.hidden ? open() : close());
      trigger.addEventListener("keydown", event => {
        const key = event.key;
        if (key === "Tab") return close();
        if (key === "Escape") { event.preventDefault(); close(); return; }
        if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
          event.preventDefault();
          if (menu.hidden) { open(); if (["Enter", " "].includes(key)) return; }
          if (["Enter", " "].includes(key)) choose(active);
          else if (key === "Home") { active = options.length - 1; move(1); }
          else if (key === "End") { active = 0; move(-1); }
          else move(key === "ArrowDown" ? 1 : -1);
        } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          if (menu.hidden) open();
          search += key.toLocaleLowerCase();
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => { search = ""; }, 700);
          const index = options.findIndex(option => !option.disabled && option.textContent.trim().toLocaleLowerCase().startsWith(search));
          if (index >= 0) highlight(index);
        }
      });
      select.addEventListener("change", sync);
      new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ["disabled"] });
      document.addEventListener("pointerdown", event => { if (!trigger.contains(event.target) && !menu.contains(event.target)) close(); });
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      window.visualViewport?.addEventListener("resize", position);
      window.visualViewport?.addEventListener("scroll", position);
      refresh.push(sync);
      sync();
    }
    const syncAll = () => queueMicrotask(() => refresh.forEach(sync => sync()));
    window.addEventListener("pageshow", syncAll);
    window.addEventListener("storage", syncAll);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncAll);
    window.addEventListener("pagehide", () => closeCurrent());
  }
  document.addEventListener("DOMContentLoaded", init);
})();
