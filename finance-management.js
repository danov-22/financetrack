(() => {
  const root = document.documentElement;
  const button = document.getElementById("hub-theme-toggle");
  const mark = document.querySelector(".hub-brand-mark");
  const name = document.querySelector(".hub-brand-name");
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  let saved = null;
  try { saved = localStorage.getItem("bewlet_finance_hub_theme"); } catch {}

  function apply(theme) {
    const dark = theme === "dark";
    root.dataset.theme = theme;
    if (button) {
      button.querySelector("b").textContent = dark ? "Light" : "Dark";
      button.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`);
    }
    if (mark) mark.src = dark ? "/bewlet_dark.svg" : "/bewlet.svg";
    if (name) name.src = dark ? "/textlogo_dark.svg" : "/textlogo.svg";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#10121d" : "#4f46e5");
  }

  apply(saved === "light" || saved === "dark" ? saved : (systemDark ? "dark" : "light"));
  button?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem("bewlet_finance_hub_theme", next); } catch {}
  });
})();
