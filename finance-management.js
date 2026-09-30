(() => {
  const root = document.documentElement;
  const button = document.getElementById("hub-theme-toggle");
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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#10121d" : "#4f46e5");
  }

  apply(saved === "light" || saved === "dark" ? saved : (systemDark ? "dark" : "light"));
  button?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem("bewlet_finance_hub_theme", next); } catch {}
  });

  const incomeInput = document.getElementById("hub-income");
  const currencyInput = document.getElementById("hub-currency");
  const resultBox = document.getElementById("hub-calculator-results");
  const templateButtons = [...document.querySelectorAll(".hub-template-options button")];
  let selectedTemplate = [50, 30, 20];

  function numericIncome() {
    const normalized = String(incomeInput?.value || "").replace(/[^0-9.]/g, "");
    return Math.max(0, Number(normalized) || 0);
  }

  function formatIncomeInput() {
    if (!incomeInput) return;
    const amount = numericIncome();
    incomeInput.value = amount ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount) : "";
  }

  function renderCalculator() {
    if (!resultBox) return;
    const income = numericIncome();
    const symbol = currencyInput?.value || "Rp";
    const isTwoPart = selectedTemplate[1] === 0;
    const labels = isTwoPart ? ["Spending", "", "Savings & Future"] : ["Needs", "Wants", "Savings & Future"];
    resultBox.innerHTML = selectedTemplate.map((percent, index) => percent > 0 ? `<article><span>${labels[index]}</span><strong>${symbol}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(income * percent / 100)}</strong><small>${percent}% of monthly income</small></article>` : "").join("");
  }

  incomeInput?.addEventListener("input", renderCalculator);
  incomeInput?.addEventListener("blur", () => { formatIncomeInput(); renderCalculator(); });
  currencyInput?.addEventListener("change", renderCalculator);
  templateButtons.forEach((templateButton) => templateButton.addEventListener("click", () => {
    selectedTemplate = templateButton.dataset.template.split(",").map(Number);
    templateButtons.forEach((item) => item.classList.toggle("active", item === templateButton));
    renderCalculator();
  }));
  renderCalculator();
})();
