// ============================================================
// CONFIGURATION — paste your Apps Script Web App URL here
// ============================================================
// Finance synchronization is provided by the authenticated Bewlet backend.
// Never embed a shared Apps Script or user credential in the public client.
const DEFAULT_GAS_URL = "";

const IS_DEMO_MODE = new URLSearchParams(location.search).get("mode") === "demo";

/* ============================================================
   PERSONAL FINANCE DASHBOARD — script.js
   ============================================================
   Sections:
   1. App State
   2. Local Storage Helpers
   3. Currency & Formatting
   4. Google Sheets API
   5. Sync Functions
   6. Transactions
   7. Wallets
   8. Categories / Settings
   9. Dashboard
   10. Charts
   11. Reports
   12. Recurring Transactions
   13. CSV Import / Export
   14. Transfer
   15. Modals
   16. Toast Notifications
   17. Navigation
   18. Theme
   19. Event Listeners & Initialization
   ============================================================ */

// ============================================================
// 1. APP STATE
// ============================================================
const STATE = {
  transactions: [],
  wallets: [],
  categories: [],
  pendingQueue: [], // offline mutations waiting to sync
  feedback: [],
  installationId: "",
  gasUrl: "",
  currency: "IDR",
  favoriteCurrencies: ["IDR", "USD", "EUR"],
  exchangeRates: {},
  exchangeRatesUpdated: null,
  theme: "light",
  themePreset: "original",
  customThemeColor: "#7c3aed",
  currentPage: "dashboard",
  dashRange: "month",
  calendarMonth: "",
  calendarSelectedDate: "",
  isOnline: navigator.onLine,
  lastSynced: null, // timestamp
  isSyncing: false,
  // chart instances
  balanceChartInst: null,
  barChartInst: null,
  doughnutChartInst: null,
};

// ============================================================
// 2. LOCAL STORAGE HELPERS
// ============================================================
const LS = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    if (IS_DEMO_MODE && key.startsWith("fin_")) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    if (IS_DEMO_MODE && key.startsWith("fin_")) return;
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

function loadStateFromLS() {
  STATE.transactions = LS.get("fin_transactions", []).map(normalizeTransactionDate);
  STATE.wallets = LS.get("fin_wallets", []);
  STATE.categories = LS.get("fin_categories", []);
  STATE.pendingQueue = LS.get("fin_pending", []);
  STATE.feedback = LS.get("fin_feedback", []);
  STATE.installationId = LS.get("fin_installation_id", "") || generateId();
  LS.set("fin_installation_id", STATE.installationId);
  STATE.gasUrl = LS.get("fin_gas_url", "") || DEFAULT_GAS_URL;
  STATE.currency = LS.get("fin_currency", "IDR");
  STATE.favoriteCurrencies = LS.get("fin_favorite_currencies", ["IDR", "USD", "EUR"]);
  const cachedRates = LS.get("fin_exchange_rates", {});
  if (cachedRates.base === STATE.currency) {
    STATE.exchangeRates = cachedRates.rates || {};
    STATE.exchangeRatesUpdated = cachedRates.updated || null;
  }
  STATE.theme = LS.get("fin_theme", "light");
  STATE.themePreset = LS.get("fin_theme_preset", "original");
  STATE.themePreset = ({ indigo: "royal", emerald: "wealth", sunset: "gold", rose: "berry" })[STATE.themePreset] || STATE.themePreset;
  STATE.customThemeColor = LS.get("fin_custom_theme_color", "#7c3aed");
  STATE.lastSynced = LS.get("fin_last_synced", null);
}

function persistTransactions() {
  LS.set("fin_transactions", STATE.transactions);
}
function persistWallets() {
  LS.set("fin_wallets", STATE.wallets);
}
function persistCategories() {
  LS.set("fin_categories", STATE.categories);
}
function persistPending() {
  LS.set("fin_pending", STATE.pendingQueue);
}
function persistFeedback() {
  LS.set("fin_feedback", STATE.feedback);
}
function persistSettings() {
  LS.set("fin_gas_url", STATE.gasUrl);
  LS.set("fin_currency", STATE.currency);
  LS.set("fin_favorite_currencies", STATE.favoriteCurrencies);
  LS.set("fin_theme", STATE.theme);
  LS.set("fin_theme_preset", STATE.themePreset);
  LS.set("fin_custom_theme_color", STATE.customThemeColor);
}

// ============================================================
// 3. CURRENCY & FORMATTING
// ============================================================
const FALLBACK_CURRENCIES = [
  "AED", "ARS", "AUD", "BDT", "BGN", "BHD", "BRL", "CAD", "CHF", "CLP",
  "CNY", "COP", "CZK", "DKK", "EGP", "EUR", "GBP", "GHS", "HKD", "HUF",
  "IDR", "ILS", "INR", "ISK", "JPY", "KES", "KRW", "KWD", "LKR", "MAD",
  "MXN", "MYR", "NGN", "NOK", "NPR", "NZD", "OMR", "PEN", "PHP", "PKR",
  "PLN", "QAR", "RON", "RSD", "RUB", "SAR", "SEK", "SGD", "THB", "TRY",
  "TWD", "UAH", "USD", "VND", "ZAR",
];

const CURRENCY_REGIONS = {
  AED: "AE", ARS: "AR", AUD: "AU", BDT: "BD", BGN: "BG", BHD: "BH",
  BRL: "BR", CAD: "CA", CHF: "CH", CLP: "CL", CNY: "CN", COP: "CO",
  CZK: "CZ", DKK: "DK", EGP: "EG", EUR: "EU", GBP: "GB", GHS: "GH",
  HKD: "HK", HUF: "HU", IDR: "ID", ILS: "IL", INR: "IN", ISK: "IS",
  JPY: "JP", KES: "KE", KRW: "KR", KWD: "KW", LKR: "LK", MAD: "MA",
  MXN: "MX", MYR: "MY", NGN: "NG", NOK: "NO", NPR: "NP", NZD: "NZ",
  OMR: "OM", PEN: "PE", PHP: "PH", PKR: "PK", PLN: "PL", QAR: "QA",
  RON: "RO", RSD: "RS", RUB: "RU", SAR: "SA", SEK: "SE", SGD: "SG",
  THB: "TH", TRY: "TR", TWD: "TW", UAH: "UA", USD: "US", VND: "VN",
  ZAR: "ZA",
};

function getCurrencyFlag(code) {
  const region = CURRENCY_REGIONS[code];
  if (!region) return "🌐";
  return [...region].map((letter) =>
    String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function getSupportedCurrencies() {
  try { return Intl.supportedValuesOf("currency"); }
  catch { return FALLBACK_CURRENCIES; }
}

function getCurrencyName(code) {
  try {
    return new Intl.DisplayNames([navigator.language || "en"], { type: "currency" }).of(code);
  } catch { return code; }
}

function populateCurrencySelects() {
  const currencies = getSupportedCurrencies();
  if (!currencies.includes(STATE.currency)) currencies.unshift(STATE.currency);
  const quickCurrencies = [...new Set([STATE.currency, ...STATE.favoriteCurrencies])]
    .filter((code) => currencies.includes(code));
  const compactOptions = quickCurrencies.map((code) =>
    `<option value="${code}">${getCurrencyFlag(code)} ${getCurrencySymbol(code)}</option>`).join("");
  const allCompactOptions = currencies.map((code) =>
    `<option value="${code}">${getCurrencyFlag(code)} ${getCurrencySymbol(code)} · ${code}</option>`).join("");
  const namedOptions = currencies.map((code) =>
    `<option value="${code}">${getCurrencyFlag(code)} ${getCurrencyName(code)}</option>`).join("");
  const topSelect = document.getElementById("currency-select");
  if (topSelect) topSelect.innerHTML = compactOptions;
  ["tx-currency", "transfer-currency"].forEach((id) => {
    const select = document.getElementById(id);
    if (select) select.innerHTML = allCompactOptions;
  });
  const settingsSelect = document.getElementById("settings-currency");
  if (settingsSelect) settingsSelect.innerHTML = namedOptions;
  const favoriteAdd = document.getElementById("favorite-currency-add");
  if (favoriteAdd) favoriteAdd.innerHTML = namedOptions;
  renderFavoriteCurrencies();
}

function renderFavoriteCurrencies() {
  const container = document.getElementById("favorite-currencies");
  if (!container) return;
  container.innerHTML = STATE.favoriteCurrencies.map((code) => `
    <span class="currency-chip">${getCurrencyFlag(code)} ${getCurrencySymbol(code)}
      <button onclick="removeFavoriteCurrency('${code}')" aria-label="Remove ${code}" ${code === STATE.currency ? "disabled" : ""}>×</button>
    </span>`).join("");
}

function addFavoriteCurrency() {
  const code = document.getElementById("favorite-currency-add")?.value;
  if (!code || STATE.favoriteCurrencies.includes(code)) return;
  STATE.favoriteCurrencies.push(code);
  persistSettings();
  populateCurrencySelects();
  document.getElementById("currency-select").value = STATE.currency;
}

function removeFavoriteCurrency(code) {
  if (code === STATE.currency) return;
  STATE.favoriteCurrencies = STATE.favoriteCurrencies.filter((item) => item !== code);
  persistSettings();
  populateCurrencySelects();
  document.getElementById("currency-select").value = STATE.currency;
}

function transactionAmount(tx) {
  const amount = parseFloat(tx.amount) || 0;
  const source = tx.currency || STATE.currency;
  if (source === STATE.currency) return amount;
  const rate = Number(STATE.exchangeRates[source]);
  return rate > 0 ? amount / rate : amount;
}

async function updateExchangeRates(force = false) {
  const status = document.getElementById("exchange-rate-status");
  const age = Date.now() - (STATE.exchangeRatesUpdated || 0);
  if (!force && Object.keys(STATE.exchangeRates).length && age < 12 * 60 * 60 * 1000) {
    if (status) status.textContent = `Rates cached ${new Date(STATE.exchangeRatesUpdated).toLocaleString()}`;
    return;
  }
  if (!navigator.onLine) {
    if (status) status.textContent = "Offline — using the last cached exchange rates.";
    return;
  }
  if (status) status.textContent = "Updating exchange rates…";
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(STATE.currency)}`);
    if (!response.ok) throw new Error("Rate service unavailable");
    const data = await response.json();
    if (data.result !== "success" || !data.rates) throw new Error("Invalid rate response");
    STATE.exchangeRates = data.rates;
    STATE.exchangeRatesUpdated = Date.now();
    LS.set("fin_exchange_rates", { base: STATE.currency, rates: data.rates, updated: STATE.exchangeRatesUpdated });
    if (status) status.textContent = `Rates updated ${new Date().toLocaleString()}`;
    refreshCurrentPage();
  } catch {
    if (status) status.textContent = "Could not update rates — totals use the latest cached rates.";
  }
}

function formatAmount(amount, currency = null) {
  const cur = currency || STATE.currency;
  try {
    return new Intl.NumberFormat(navigator.language || "en-US", {
      style: "currency", currency: cur, currencyDisplay: "narrowSymbol",
    }).format(Number(amount) || 0);
  } catch {
    return `${cur} ${(Number(amount) || 0).toLocaleString()}`;
  }
}

function getCurrencySymbol(cur = null) {
  const c = cur || STATE.currency;
  try {
    return new Intl.NumberFormat(navigator.language || "en-US", {
      style: "currency", currency: c, currencyDisplay: "narrowSymbol",
    }).formatToParts(0).find((part) => part.type === "currency")?.value || c;
  } catch { return c; }
}

function parseAmount(str) {
  return (
    parseFloat(
      String(str)
        .replace(/[^0-9.,-]/g, "")
        .replace(",", "."),
    ) || 0
  );
}

function normalizeDateValue(value) {
  if (!value) return "";
  const text = String(value);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTransactionDate(transaction) {
  return { ...transaction, date: normalizeDateValue(transaction.date) };
}

// ============================================================
// 4. GOOGLE SHEETS API
// ============================================================
async function gasRequest(params) {
  if (!STATE.gasUrl) throw new Error("GAS URL not configured");
  const url = STATE.gasUrl;

  if (params.method === "GET") {
    const qs = new URLSearchParams(params.query).toString();
    const res = await fetch(`${url}?${qs}`, { method: "GET" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  }

  // POST — send as application/x-www-form-urlencoded to avoid CORS preflight
  const body = new URLSearchParams({ payload: JSON.stringify(params.body) });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(params.body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text);
}

async function apiGetAll() {
  return gasRequest({ method: "GET", query: { action: "getAll" } });
}

async function apiGetSettings() {
  return gasRequest({ method: "GET", query: { action: "getSettings" } });
}

async function apiAdd(tx) {
  return gasRequest({ method: "POST", body: { action: "add", ...tx } });
}

async function apiUpdate(tx) {
  return gasRequest({ method: "POST", body: { action: "update", ...tx } });
}

async function apiDelete(id) {
  return gasRequest({ method: "POST", body: { action: "delete", id } });
}

async function apiAddSetting(type, name) {
  return gasRequest({
    method: "POST",
    body: { action: "addSetting", type, name },
  });
}

async function apiDeleteSetting(type, name) {
  return gasRequest({
    method: "POST",
    body: { action: "deleteSetting", type, name },
  });
}

async function apiGetFeedback() {
  return gasRequest({ method: "GET", query: { action: "getFeedback", userId: STATE.installationId } });
}

async function apiSaveFeedback(feedback) {
  return gasRequest({ method: "POST", body: { action: "saveFeedback", ...feedback } });
}

async function apiWithdrawFeedback(id) {
  return gasRequest({ method: "POST", body: { action: "withdrawFeedback", id, userId: STATE.installationId } });
}

async function apiDeleteFeedback(id) {
  return gasRequest({ method: "POST", body: { action: "deleteFeedback", id, userId: STATE.installationId } });
}

// ============================================================
// 5. SYNC FUNCTIONS
// ============================================================
function setSyncStatus(status, label) {
  const indicator = document.getElementById("sync-indicator");
  const syncIcon = indicator.querySelector(".sync-icon");
  const syncLabel = document.getElementById("sync-label");

  indicator.className = `sync-indicator ${status}`;
  syncIcon.classList.toggle("spinning", status === "syncing");
  syncLabel.textContent = label;
}

function updateSyncDisplay() {
  if (IS_DEMO_MODE) {
    setSyncStatus("", "Demo data");
    return;
  }
  if (!STATE.isOnline) {
    const pending = STATE.pendingQueue.length;
    setSyncStatus("offline", pending > 0 ? `${pending} pending` : "Offline");
    return;
  }
  if (STATE.isSyncing) {
    setSyncStatus("syncing", "Syncing...");
    return;
  }
  if (STATE.pendingQueue.length > 0) {
    setSyncStatus("offline", `${STATE.pendingQueue.length} pending`);
    return;
  }
  if (STATE.lastSynced) {
    const d = new Date(STATE.lastSynced);
    setSyncStatus("", `Synced ${formatSyncTime(d)}`);
  } else {
    setSyncStatus("", "Not synced");
  }
}

function formatSyncTime(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function syncNow() {
  if (IS_DEMO_MODE) {
    showToast("Demo data resets automatically and is not synced.", "info");
    return;
  }
  if (!STATE.gasUrl) {
    showToast(
      "Set up your Google Apps Script URL in Settings first.",
      "warning",
    );
    navigate("settings");
    return;
  }
  if (!STATE.isOnline) {
    showToast("You are offline. Will sync when back online.", "warning");
    return;
  }

  STATE.isSyncing = true;
  updateSyncDisplay();

  try {
    // First drain pending queue
    await drainPendingQueue();

    // Then fetch fresh data
    const [txRes, settingsRes] = await Promise.all([
      apiGetAll(),
      apiGetSettings(),
    ]);

    if (txRes.success) {
      STATE.transactions = (txRes.data || []).map(normalizeTransactionDate);
      persistTransactions();
    }
    if (settingsRes.success) {
      STATE.wallets = settingsRes.data.wallets || STATE.wallets;
      STATE.categories = settingsRes.data.categories || STATE.categories;
      persistWallets();
      persistCategories();
    }

    STATE.lastSynced = Date.now();
    LS.set("fin_last_synced", STATE.lastSynced);
    showToast("Data synced successfully!", "success");
    refreshCurrentPage();
  } catch (err) {
    console.error("Sync failed:", err);
    showToast("Sync failed: " + err.message, "error");
  } finally {
    STATE.isSyncing = false;
    updateSyncDisplay();
  }
}

async function drainPendingQueue() {
  if (!STATE.pendingQueue.length || !STATE.isOnline || !STATE.gasUrl) return;

  const queue = [...STATE.pendingQueue];
  const failed = [];

  for (const op of queue) {
    try {
      if (op.action === "add") await apiAdd(op.data);
      else if (op.action === "update") await apiUpdate(op.data);
      else if (op.action === "delete") await apiDelete(op.id);
      else if (op.action === "addSetting")
        await apiAddSetting(op.settingType, op.name);
      else if (op.action === "deleteSetting")
        await apiDeleteSetting(op.settingType, op.name);
      else if (op.action === "deleteFeedback") {
        const response = await apiDeleteFeedback(op.id);
        if (!response.success) throw new Error(response.error || "Feedback delete failed");
      }
    } catch {
      failed.push(op);
    }
  }

  STATE.pendingQueue = failed;
  persistPending();
  updateSyncDisplay();
}

function queueOperation(op) {
  STATE.pendingQueue.push(op);
  persistPending();
  updateSyncDisplay();
}

// ============================================================
// 6. TRANSACTIONS
// ============================================================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getTodayISO() {
  return formatLocalISODate(new Date());
}

function formatLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function saveTransaction(txData) {
  const isEdit = !!txData.id;

  if (!isEdit) txData.id = generateId();
  txData.createdTime = txData.createdTime || new Date().toISOString();

  if (isEdit) {
    const idx = STATE.transactions.findIndex((t) => t.id === txData.id);
    if (idx > -1) STATE.transactions[idx] = txData;
    else STATE.transactions.push(txData);
  } else {
    STATE.transactions.push(txData);
  }
  persistTransactions();

  // Try remote
  if (STATE.gasUrl && STATE.isOnline) {
    try {
      if (isEdit) await apiUpdate(txData);
      else await apiAdd(txData);
      STATE.lastSynced = Date.now();
      LS.set("fin_last_synced", STATE.lastSynced);
    } catch {
      queueOperation({ action: isEdit ? "update" : "add", data: txData });
    }
  } else if (STATE.gasUrl) {
    queueOperation({ action: isEdit ? "update" : "add", data: txData });
  }

  updateSyncDisplay();
  refreshCurrentPage();
}

async function deleteTransaction(id) {
  STATE.transactions = STATE.transactions.filter((t) => t.id !== id);
  persistTransactions();

  if (STATE.gasUrl && STATE.isOnline) {
    try {
      await apiDelete(id);
      STATE.lastSynced = Date.now();
      LS.set("fin_last_synced", STATE.lastSynced);
    } catch {
      queueOperation({ action: "delete", id });
    }
  } else if (STATE.gasUrl) {
    queueOperation({ action: "delete", id });
  }

  updateSyncDisplay();
  refreshCurrentPage();
}

function getFilteredTransactions() {
  const wallet = document.getElementById("filter-wallet")?.value || "";
  const type = document.getElementById("filter-type")?.value || "";
  const category = document.getElementById("filter-category")?.value || "";
  const dateFrom = document.getElementById("filter-date-from")?.value || "";
  const dateTo = document.getElementById("filter-date-to")?.value || "";

  return STATE.transactions
    .filter((tx) => {
      if (wallet && tx.wallet !== wallet) return false;
      if (type && tx.type !== type) return false;
      if (category && tx.category !== category) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.date) - new Date(a.date) ||
        b.createdTime?.localeCompare(a.createdTime),
    );
}

function renderTransactionsList() {
  const list = document.getElementById("transactions-list");
  if (!list) return;

  const txs = getFilteredTransactions();
  document.getElementById("transactions-count").textContent =
    `${txs.length} transaction${txs.length !== 1 ? "s" : ""}`;

  if (!txs.length) {
    list.innerHTML = emptyStateHtml(
      "No transactions found",
      "Try adjusting your filters or add a new transaction.",
    );
    return;
  }

  list.innerHTML = txs.map((tx) => txItemHtml(tx)).join("");
}

// ============================================================
// CALENDAR
// ============================================================
function getCalendarTransactions(date) {
  return STATE.transactions
    .filter((transaction) => normalizeDateValue(transaction.date) === date)
    .sort((a, b) => (b.createdTime || "").localeCompare(a.createdTime || ""));
}

function getCalendarDayTotals(transactions) {
  const income = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transactionAmount(transaction), 0);
  const expense = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transactionAmount(transaction), 0);
  return { income, expense, net: income - expense };
}

function formatCalendarCompact(amount) {
  if (!amount) return "";
  try {
    return new Intl.NumberFormat(navigator.language || "en", {
      notation: "compact", maximumFractionDigits: 1,
    }).format(amount);
  } catch { return Math.round(amount).toLocaleString(); }
}

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;
  if (!STATE.calendarMonth) STATE.calendarMonth = getTodayISO().slice(0, 7);
  if (!STATE.calendarSelectedDate) STATE.calendarSelectedDate = getTodayISO();

  const [year, monthNumber] = STATE.calendarMonth.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const monthStart = new Date(year, monthIndex, 1);
  const gridStart = new Date(year, monthIndex, 1 - monthStart.getDay());
  document.getElementById("calendar-month-label").textContent = monthStart.toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  const today = getTodayISO();
  const cells = [];
  for (let index = 0; index < 42; index++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + index);
    const isoDate = formatLocalISODate(cellDate);
    const transactions = getCalendarTransactions(isoDate);
    const totals = getCalendarDayTotals(transactions);
    const outside = cellDate.getMonth() !== monthIndex;
    cells.push(`<button class="calendar-cell${outside ? " outside" : ""}${isoDate === today ? " today" : ""}${isoDate === STATE.calendarSelectedDate ? " selected" : ""}" onclick="selectCalendarDate('${isoDate}')" aria-label="${cellDate.toLocaleDateString()}">
      <span class="calendar-day-number">${cellDate.getDate()}</span>
      ${transactions.length ? `<span class="calendar-cell-count">${transactions.length}</span>` : ""}
      <span class="calendar-cell-values">
        ${totals.income ? `<i class="income">+${formatCalendarCompact(totals.income)}</i>` : ""}
        ${totals.expense ? `<i class="expense">−${formatCalendarCompact(totals.expense)}</i>` : ""}
      </span>
      ${transactions.length ? `<span class="calendar-dots">${totals.income ? '<i class="income"></i>' : ""}${totals.expense ? '<i class="expense"></i>' : ""}</span>` : ""}
    </button>`);
  }
  grid.innerHTML = cells.join("");
  renderCalendarSelectedDay();
}

function renderCalendarSelectedDay() {
  const date = STATE.calendarSelectedDate || getTodayISO();
  const transactions = getCalendarTransactions(date);
  const totals = getCalendarDayTotals(transactions);
  const selectedDate = new Date(`${date}T00:00:00`);
  setEl("calendar-selected-label", selectedDate.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }));
  setEl("calendar-day-income", formatAmount(totals.income));
  setEl("calendar-day-expense", formatAmount(totals.expense));
  setEl("calendar-day-net", formatAmount(totals.net));
  const list = document.getElementById("calendar-day-transactions");
  if (list) list.innerHTML = transactions.length
    ? transactions.map((transaction) => txItemHtml(transaction)).join("")
    : emptyStateHtml("No transactions", "Tap Add to record something on this day.");
}

function selectCalendarDate(date) {
  STATE.calendarSelectedDate = date;
  STATE.calendarMonth = date.slice(0, 7);
  renderCalendar();
}

function changeCalendarMonth(offset) {
  const [year, month] = STATE.calendarMonth.split("-").map(Number);
  const next = new Date(year, month - 1 + offset, 1);
  STATE.calendarMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  STATE.calendarSelectedDate = `${STATE.calendarMonth}-01`;
  renderCalendar();
}

function goCalendarToday() {
  STATE.calendarSelectedDate = getTodayISO();
  STATE.calendarMonth = STATE.calendarSelectedDate.slice(0, 7);
  renderCalendar();
}

function openTransactionForDate(date = STATE.calendarSelectedDate) {
  openTransactionModal(null, date || getTodayISO());
}

function openQuickTransaction() {
  if (STATE.currentPage === "calendar") openTransactionForDate();
  else openTransactionModal();
}

function txItemHtml(tx) {
  const amt = formatAmount(tx.amount, tx.currency);
  const isConverted = tx.currency && tx.currency !== STATE.currency;
  const convertedAmt = isConverted ? formatAmount(transactionAmount(tx)) : "";
  const sign = tx.type === "income" ? "+" : "−";
  const cls = tx.type;
  const icon = tx.type === "income" ? "↑" : "↓";
  const desc = tx.description || tx.category || tx.type;
  const dateStr = formatDateShort(tx.date);

  return `<div class="tx-item" ondblclick="openEditTransaction('${tx.id}')">
    <div class="tx-icon ${cls}">${icon}</div>
    <div class="tx-info">
      <div class="tx-desc">${escHtml(desc)}</div>
      <div class="tx-meta">
        <span>${dateStr}</span>
        ${tx.wallet ? `<span class="tx-badge">${escHtml(tx.wallet)}</span>` : ""}
        ${tx.category ? `<span class="tx-badge">${escHtml(tx.category)}</span>` : ""}
        ${tx.currency && tx.currency !== STATE.currency ? `<span class="tx-badge">${tx.currency}</span>` : ""}
        ${tx.recurring ? `<span class="tx-badge">🔁</span>` : ""}
      </div>
    </div>
    <div class="tx-amount ${cls}">${sign}${amt}${isConverted ? `<small>≈ ${sign}${convertedAmt}</small>` : ""}</div>
    <div class="tx-actions">
      <button class="tx-action-btn" onclick="openEditTransaction('${tx.id}')" title="Edit">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="tx-action-btn delete" onclick="confirmDelete('transaction','${tx.id}','${escHtml(desc)}')" title="Delete">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  </div>`;
}

function emptyStateHtml(title, sub = "") {
  return `<div class="empty-state">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
    <p><strong>${title}</strong></p>
    ${sub ? `<p style="margin-top:4px">${sub}</p>` : ""}
  </div>`;
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  // Extract YYYY-MM-DD from any format Google Sheets might return
  const iso = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
  const d = iso ? new Date(iso[0] + "T00:00:00") : new Date(dateStr);
  if (isNaN(d)) return String(dateStr); // never show "Invalid Date"
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// 7. WALLETS
// ============================================================
function saveWallet(name, oldName = null) {
  const trimmed = name.trim();
  if (!trimmed) return false;

  if (oldName) {
    // Edit — rename in wallet list and update all transactions
    const idx = STATE.wallets.indexOf(oldName);
    if (idx > -1) STATE.wallets[idx] = trimmed;
    STATE.transactions.forEach((tx) => {
      if (tx.wallet === oldName) tx.wallet = trimmed;
    });
    persistTransactions();
    // fire-and-forget to GAS
    if (STATE.gasUrl && STATE.isOnline) {
      Promise.all([apiDeleteSetting("Wallet", oldName), apiAddSetting("Wallet", trimmed)]).catch(() => {
        queueOperation({ action: "deleteSetting", settingType: "Wallet", name: oldName });
        queueOperation({ action: "addSetting",    settingType: "Wallet", name: trimmed });
      });
    } else if (STATE.gasUrl) {
      queueOperation({ action: "deleteSetting", settingType: "Wallet", name: oldName });
      queueOperation({ action: "addSetting",    settingType: "Wallet", name: trimmed });
    }
  } else {
    if (STATE.wallets.includes(trimmed)) {
      showToast("Wallet already exists.", "warning");
      return false;
    }
    STATE.wallets.push(trimmed);
    // fire-and-forget to GAS
    if (STATE.gasUrl && STATE.isOnline) {
      apiAddSetting("Wallet", trimmed).catch(() => {
        queueOperation({ action: "addSetting", settingType: "Wallet", name: trimmed });
      });
    } else if (STATE.gasUrl) {
      queueOperation({ action: "addSetting", settingType: "Wallet", name: trimmed });
    }
  }

  persistWallets();
  updateSyncDisplay();
  return true;
}

function deleteWallet(name) {
  STATE.wallets = STATE.wallets.filter((w) => w !== name);
  persistWallets();

  if (STATE.gasUrl && STATE.isOnline) {
    apiDeleteSetting("Wallet", name).catch(() => {
      queueOperation({ action: "deleteSetting", settingType: "Wallet", name });
    });
  } else if (STATE.gasUrl) {
    queueOperation({ action: "deleteSetting", settingType: "Wallet", name });
  }

  updateSyncDisplay();
  refreshCurrentPage();
}

function getWalletBalance(walletName) {
  return STATE.transactions
    .filter((tx) => tx.wallet === walletName)
    .reduce((sum, tx) => {
      const amt = transactionAmount(tx);
      return tx.type === "income" ? sum + amt : sum - amt;
    }, 0);
}

function renderWallets() {
  const grid = document.getElementById("wallets-grid");
  if (!grid) return;

  if (!STATE.wallets.length) {
    grid.innerHTML = emptyStateHtml(
      "No wallets yet",
      "Add a wallet to start tracking your finances.",
    );
    return;
  }

  grid.innerHTML = STATE.wallets
    .map((name) => {
      const balance = getWalletBalance(name);
      const income = STATE.transactions
        .filter((t) => t.wallet === name && t.type === "income")
        .reduce((s, t) => s + transactionAmount(t), 0);
      const expense = STATE.transactions
        .filter((t) => t.wallet === name && t.type === "expense")
        .reduce((s, t) => s + transactionAmount(t), 0);
      return `<div class="wallet-card">
      <div class="wallet-card-header">
        <span class="wallet-card-name">${escHtml(name)}</span>
        <div class="wallet-card-actions">
          <button class="btn-icon" onclick="openWalletModal('${escHtml(name)}')" title="Edit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="confirmDelete('wallet','${escHtml(name)}','${escHtml(name)}')" title="Delete">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div class="wallet-card-balance">${formatAmount(balance)}</div>
      <div class="wallet-card-stats">
        <div class="wallet-stat inc"><strong>${formatAmount(income)}</strong>Income</div>
        <div class="wallet-stat exp"><strong>${formatAmount(expense)}</strong>Expenses</div>
      </div>
    </div>`;
    })
    .join("");
}

// ============================================================
// 8. CATEGORIES / SETTINGS
// ============================================================
function saveCategory(name, oldName = null) {
  const trimmed = name.trim();
  if (!trimmed) return false;

  if (oldName) {
    const idx = STATE.categories.indexOf(oldName);
    if (idx > -1) STATE.categories[idx] = trimmed;
    STATE.transactions.forEach((tx) => {
      if (tx.category === oldName) tx.category = trimmed;
    });
    persistTransactions();
    // fire-and-forget to GAS
    if (STATE.gasUrl && STATE.isOnline) {
      Promise.all([apiDeleteSetting("Category", oldName), apiAddSetting("Category", trimmed)]).catch(() => {
        queueOperation({ action: "deleteSetting", settingType: "Category", name: oldName });
        queueOperation({ action: "addSetting",    settingType: "Category", name: trimmed });
      });
    } else if (STATE.gasUrl) {
      queueOperation({ action: "deleteSetting", settingType: "Category", name: oldName });
      queueOperation({ action: "addSetting",    settingType: "Category", name: trimmed });
    }
  } else {
    if (STATE.categories.includes(trimmed)) {
      showToast("Category already exists.", "warning");
      return false;
    }
    STATE.categories.push(trimmed);
    // fire-and-forget to GAS
    if (STATE.gasUrl && STATE.isOnline) {
      apiAddSetting("Category", trimmed).catch(() => {
        queueOperation({ action: "addSetting", settingType: "Category", name: trimmed });
      });
    } else if (STATE.gasUrl) {
      queueOperation({ action: "addSetting", settingType: "Category", name: trimmed });
    }
  }

  persistCategories();
  updateSyncDisplay();
  return true;
}

function deleteCategory(name) {
  STATE.categories = STATE.categories.filter((c) => c !== name);
  persistCategories();

  if (STATE.gasUrl && STATE.isOnline) {
    apiDeleteSetting("Category", name).catch(() => {
      queueOperation({ action: "deleteSetting", settingType: "Category", name });
    });
  } else if (STATE.gasUrl) {
    queueOperation({ action: "deleteSetting", settingType: "Category", name });
  }

  updateSyncDisplay();
  refreshCurrentPage();
}

function renderSettingsLists() {
  const walletsList = document.getElementById("settings-wallets-list");
  const catList = document.getElementById("settings-categories-list");
  if (!walletsList || !catList) return;

  walletsList.innerHTML = STATE.wallets.length
    ? STATE.wallets
        .map(
          (w) => `
      <div class="settings-list-item">
        <span>${escHtml(w)}</span>
        <div class="settings-list-item-actions">
          <button class="btn-icon" onclick="openWalletModal('${escHtml(w)}')" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="confirmDelete('wallet','${escHtml(w)}','${escHtml(w)}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`,
        )
        .join("")
    : '<p style="font-size:.82rem;color:var(--text-3)">No wallets added yet.</p>';

  catList.innerHTML = STATE.categories.length
    ? STATE.categories
        .map(
          (c) => `
      <div class="settings-list-item">
        <span>${escHtml(c)}</span>
        <div class="settings-list-item-actions">
          <button class="btn-icon" onclick="openCategoryModal('${escHtml(c)}')" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="confirmDelete('category','${escHtml(c)}','${escHtml(c)}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`,
        )
        .join("")
    : '<p style="font-size:.82rem;color:var(--text-3)">No categories added yet.</p>';

  const gasInput = document.getElementById("gas-url-input");
  if (gasInput) gasInput.value = STATE.gasUrl || "";

  const settingsCurrency = document.getElementById("settings-currency");
  if (settingsCurrency) settingsCurrency.value = STATE.currency;
}

function saveGASUrl() {
  const val = document.getElementById("gas-url-input").value.trim();
  STATE.gasUrl = val;
  persistSettings();
  showToast("Google Apps Script URL saved.", "success");
  updateGasBanner();
}

function saveCurrency(value) {
  if (!getSupportedCurrencies().includes(value)) return;
  STATE.currency = value;
  if (!STATE.favoriteCurrencies.includes(value)) STATE.favoriteCurrencies.unshift(value);
  STATE.exchangeRates = {};
  STATE.exchangeRatesUpdated = null;
  persistSettings();
  populateCurrencySelects();
  document.getElementById("currency-select").value = value;
  const settingsCurrency = document.getElementById("settings-currency");
  if (settingsCurrency) settingsCurrency.value = value;
  refreshCurrentPage();
  updateExchangeRates(true);
}

async function testConnection() {
  const status = document.getElementById("connection-status");
  status.className = "connection-status";
  status.textContent = "Testing...";

  if (!STATE.gasUrl) {
    status.className = "connection-status err";
    status.textContent = "Please enter a URL first.";
    return;
  }

  try {
    const res = await apiGetSettings();
    if (res.success !== false) {
      status.className = "connection-status ok";
      status.textContent = "✓ Connection successful!";
    } else {
      status.className = "connection-status err";
      status.textContent = "✗ Connected but API returned an error.";
    }
  } catch (err) {
    status.className = "connection-status err";
    status.textContent = `✗ Failed: ${err.message}`;
  }
}

function updateGasBanner() {
  const banner = document.getElementById("gas-banner");
  if (banner) banner.classList.add("hidden");
}

function confirmReset() {
  openConfirmModal(
    "Reset All Data",
    "This will delete ALL local transactions, wallets, and categories. This cannot be undone. Google Sheets data is not affected.",
    () => {
      STATE.transactions = [];
      STATE.wallets = [];
      STATE.categories = [];
      STATE.pendingQueue = [];
      persistTransactions();
      persistWallets();
      persistCategories();
      persistPending();
      showToast("All local data has been reset.", "info");
      refreshCurrentPage();
    },
  );
}

// ============================================================
// 9. DASHBOARD
// ============================================================
function getDateRangeBounds(range) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let from, to;

  if (range === "month") {
    from = new Date(year, month, 1);
    to = new Date(year, month + 1, 0);
  } else if (range === "3month") {
    from = new Date(year, month - 2, 1);
    to = new Date(year, month + 1, 0);
  } else {
    // year
    from = new Date(year, 0, 1);
    to = new Date(year, 11, 31);
  }

  return {
    from: formatLocalISODate(from),
    to: formatLocalISODate(to),
  };
}

function renderDashboard() {
  const range = STATE.dashRange;
  const { from, to } = getDateRangeBounds(range);
  const periodTxs = STATE.transactions.filter(
    (tx) => tx.date >= from && tx.date <= to,
  );

  const income = periodTxs
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + transactionAmount(t), 0);
  const expenses = periodTxs
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + transactionAmount(t), 0);
  const savings = income - expenses;
  const savingsRate = income > 0 ? Math.round((savings / income) * 100) : 0;

  const totalBalance = STATE.wallets.reduce(
    (s, w) => s + getWalletBalance(w),
    0,
  );

  setEl("dash-total-balance", formatAmount(totalBalance));
  setEl("dash-income", formatAmount(income));
  setEl("dash-expenses", formatAmount(expenses));
  setEl("dash-savings", formatAmount(savings));
  setEl("dash-savings-rate", `${savingsRate}% savings rate`);
  setEl(
    "dash-balance-wallets",
    `${STATE.wallets.length} wallet${STATE.wallets.length !== 1 ? "s" : ""}`,
  );

  // Wallet breakdown
  const breakdown = document.getElementById("wallet-breakdown");
  if (breakdown) {
    if (!STATE.wallets.length) {
      breakdown.innerHTML = emptyStateHtml(
        "No wallets",
        "Add wallets in Settings.",
      );
    } else {
      breakdown.innerHTML = STATE.wallets
        .map(
          (w) => `
        <div class="wallet-breakdown-item">
          <span class="wallet-name">${escHtml(w)}</span>
          <span class="wallet-amount">${formatAmount(getWalletBalance(w))}</span>
        </div>`,
        )
        .join("");
    }
  }

  // Recent transactions (last 5)
  const recent = document.getElementById("recent-transactions");
  if (recent) {
    const latest = [...STATE.transactions]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);
    if (!latest.length) {
      recent.innerHTML = emptyStateHtml(
        "No transactions yet",
        "Add your first transaction using the + button.",
      );
    } else {
      recent.innerHTML = latest.map((tx) => txItemHtml(tx)).join("");
    }
  }

  // Charts
  renderBalanceChart();
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ============================================================
// 10. CHARTS
// ============================================================
const CHART_COLORS = [
  "#4f46e5",
  "#10b981",
  "#ef4444",
  "#f59e0b",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

function getChartTextColor() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--text")
      .trim() || "#1a1d2e"
  );
}

function getChartGridColor() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--border")
      .trim() || "#e2e4ea"
  );
}

function destroyChart(instance) {
  if (instance) {
    try {
      instance.destroy();
    } catch {}
  }
  return null;
}

function renderBalanceChart() {
  const ctx = document.getElementById("balance-chart");
  if (!ctx) return;

  STATE.balanceChartInst = destroyChart(STATE.balanceChartInst);

  const { from } = getDateRangeBounds(STATE.dashRange);
  const sorted = [...STATE.transactions]
    .filter((tx) => tx.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build cumulative balance by date
  const dateMap = {};
  sorted.forEach((tx) => {
    const d = tx.date.slice(0, 10);
    const amt = transactionAmount(tx);
    dateMap[d] = (dateMap[d] || 0) + (tx.type === "income" ? amt : -amt);
  });

  const allDates = Object.keys(dateMap).sort();
  let running = 0;
  const labels = [];
  const data = [];
  allDates.forEach((d) => {
    running += dateMap[d];
    labels.push(d);
    data.push(running);
  });

  const textColor = getChartTextColor();
  const gridColor = getChartGridColor();

  STATE.balanceChartInst = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Balance",
          data,
          borderColor: "#4f46e5",
          backgroundColor: "rgba(79,70,229,0.1)",
          fill: true,
          tension: 0.4,
          pointRadius: data.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, maxTicksLimit: 8, font: { size: 11 } },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (v) => formatAmount(v),
          },
        },
      },
    },
  });
}

function renderBarChart(monthlyData) {
  const ctx = document.getElementById("bar-chart");
  if (!ctx) return;

  STATE.barChartInst = destroyChart(STATE.barChartInst);

  const textColor = getChartTextColor();
  const gridColor = getChartGridColor();

  STATE.barChartInst = new Chart(ctx, {
    type: "bar",
    data: {
      labels: monthlyData.map((m) => m.label),
      datasets: [
        {
          label: "Income",
          data: monthlyData.map((m) => m.income),
          backgroundColor: "rgba(16,185,129,0.75)",
          borderRadius: 6,
        },
        {
          label: "Expenses",
          data: monthlyData.map((m) => m.expenses),
          backgroundColor: "rgba(239,68,68,0.75)",
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textColor, font: { size: 12 } } },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 11 } },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            callback: (v) => formatAmount(v),
          },
        },
      },
    },
  });
}

function renderDoughnutChart(categoryData) {
  const ctx = document.getElementById("doughnut-chart");
  const legendEl = document.getElementById("category-legend");
  if (!ctx) return;

  STATE.doughnutChartInst = destroyChart(STATE.doughnutChartInst);

  if (!categoryData.length) {
    if (legendEl) legendEl.innerHTML = "";
    return;
  }

  const textColor = getChartTextColor();
  const colors = categoryData.map(
    (_, i) => CHART_COLORS[i % CHART_COLORS.length],
  );
  const total = categoryData.reduce((s, c) => s + c.amount, 0);

  STATE.doughnutChartInst = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: categoryData.map((c) => c.label),
      datasets: [
        {
          data: categoryData.map((c) => c.amount),
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${formatAmount(ctx.raw)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  if (legendEl) {
    legendEl.innerHTML = categoryData
      .map(
        (c, i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${colors[i]}"></div>
        <span>${escHtml(c.label)}</span>
      </div>`,
      )
      .join("");
  }
}

// ============================================================
// 11. REPORTS
// ============================================================
function initReportSelects() {
  const monthEl = document.getElementById("report-month");
  const yearEl = document.getElementById("report-year");
  if (!monthEl || !yearEl) return;

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  monthEl.innerHTML = months
    .map((m, i) => `<option value="${i}">${m}</option>`)
    .join("");

  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++)
    years.push(y);
  yearEl.innerHTML = years
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("");

  monthEl.value = now.getMonth();
  yearEl.value = now.getFullYear();
}

function renderReports() {
  const monthEl = document.getElementById("report-month");
  const yearEl = document.getElementById("report-year");
  const month = parseInt(monthEl?.value ?? new Date().getMonth());
  const year = parseInt(yearEl?.value ?? new Date().getFullYear());

  // 6-month bar chart
  const monthlyData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    const from = formatLocalISODate(new Date(y, m, 1));
    const to = formatLocalISODate(new Date(y, m + 1, 0));
    const txs = STATE.transactions.filter(
      (tx) => tx.date >= from && tx.date <= to,
    );
    monthlyData.push({
      label: d.toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
      }),
      income: txs
        .filter((t) => t.type === "income")
        .reduce((s, t) => s + transactionAmount(t), 0),
      expenses: txs
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + transactionAmount(t), 0),
    });
  }
  renderBarChart(monthlyData);

  // Category doughnut (selected month)
  const from = formatLocalISODate(new Date(year, month, 1));
  const to = formatLocalISODate(new Date(year, month + 1, 0));
  const expenseTxs = STATE.transactions.filter(
    (tx) => tx.type === "expense" && tx.date >= from && tx.date <= to,
  );

  const catMap = {};
  expenseTxs.forEach((tx) => {
    const cat = tx.category || "Uncategorized";
    catMap[cat] = (catMap[cat] || 0) + transactionAmount(tx);
  });

  const categoryData = Object.entries(catMap)
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  renderDoughnutChart(categoryData);

  // Monthly summary table
  const summaryEl = document.getElementById("monthly-summary");
  if (summaryEl) {
    summaryEl.innerHTML = monthlyData
      .map(
        (m) => `
      <div class="month-summary-item">
        <div class="month-name">${m.label}</div>
        <div class="month-income">+${formatAmount(m.income)}</div>
        <div class="month-expense">−${formatAmount(m.expenses)}</div>
      </div>`,
      )
      .join("");
  }
}

// ============================================================
// 12. RECURRING TRANSACTIONS
// ============================================================
function checkRecurringTransactions() {
  const today = getTodayISO();
  const added = [];

  STATE.transactions.forEach((tx) => {
    if (!tx.recurring || !tx.recurringFreq) return;

    const lastDate = tx.lastRecurring || tx.date;
    const nextDate = getNextRecurringDate(lastDate, tx.recurringFreq);

    if (nextDate <= today) {
      const newTx = {
        ...tx,
        id: generateId(),
        date: nextDate,
        lastRecurring: undefined,
        recurring: true,
        recurringFreq: tx.recurringFreq,
        createdTime: new Date().toISOString(),
        description: (tx.description || "") + " (auto)",
      };
      added.push(newTx);

      // Update lastRecurring on original
      tx.lastRecurring = nextDate;
    }
  });

  if (added.length > 0) {
    STATE.transactions.push(...added);
    persistTransactions();
    showToast(
      `${added.length} recurring transaction${added.length > 1 ? "s" : ""} added.`,
      "info",
    );
    added.forEach((tx) => {
      if (STATE.gasUrl && STATE.isOnline) {
        apiAdd(tx).catch(() => queueOperation({ action: "add", data: tx }));
      } else if (STATE.gasUrl) {
        queueOperation({ action: "add", data: tx });
      }
    });
  }
}

function getNextRecurringDate(fromDate, freq) {
  const d = new Date(fromDate + "T00:00:00");
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return formatLocalISODate(d);
}

// ============================================================
// 13. CSV IMPORT / EXPORT
// ============================================================
function exportCSV() {
  const txs = getFilteredTransactions();
  if (!txs.length) {
    showToast("No transactions to export.", "warning");
    return;
  }

  const headers = [
    "ID",
    "Date",
    "Wallet",
    "Type",
    "Category",
    "Description",
    "Amount",
    "Currency",
    "Created Time",
  ];
  const rows = txs.map((tx) => [
    tx.id,
    tx.date,
    tx.wallet || "",
    tx.type,
    tx.category || "",
    tx.description || "",
    tx.amount,
    tx.currency || STATE.currency,
    tx.createdTime || "",
  ]);

  const csv = [headers, ...rows]
    .map((r) =>
      r.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${getTodayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${txs.length} transactions.`, "success");
}

function importCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const lines = e.target.result.split("\n").filter((l) => l.trim());
      const header = lines[0]
        .split(",")
        .map((h) => h.replace(/"/g, "").trim().toLowerCase());

      const colIdx = {
        id: header.indexOf("id"),
        date: header.indexOf("date"),
        wallet: header.indexOf("wallet"),
        type: header.indexOf("type"),
        category: header.indexOf("category"),
        description: header.indexOf("description"),
        amount: header.indexOf("amount"),
        currency: header.indexOf("currency"),
        createdTime: header.indexOf("created time"),
      };

      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (!cols.length) continue;

        const get = (key) =>
          colIdx[key] > -1
            ? (cols[colIdx[key]] || "").replace(/"/g, "").trim()
            : "";

        const amount = parseFloat(get("amount"));
        if (!amount || !get("date") || !get("type")) continue;

        const tx = {
          id: get("id") || generateId(),
          date: get("date"),
          wallet: get("wallet"),
          type: get("type").toLowerCase() === "income" ? "income" : "expense",
          category: get("category"),
          description: get("description"),
          amount,
          currency: get("currency") || STATE.currency,
          createdTime: get("createdTime") || new Date().toISOString(),
        };

        const existing = STATE.transactions.findIndex((t) => t.id === tx.id);
        if (existing > -1) STATE.transactions[existing] = tx;
        else STATE.transactions.push(tx);
        imported++;
      }

      persistTransactions();
      showToast(`Imported ${imported} transactions.`, "success");
      refreshCurrentPage();
    } catch (err) {
      showToast("CSV import failed: " + err.message, "error");
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ============================================================
// 14. TRANSFER
// ============================================================
async function submitTransfer(event) {
  event.preventDefault();

  const from = document.getElementById("transfer-from").value;
  const to = document.getElementById("transfer-to").value;
  const amount = parseFloat(document.getElementById("transfer-amount").value);
  const currency = document.getElementById("transfer-currency").value;
  const date = document.getElementById("transfer-date").value;
  const desc = document.getElementById("transfer-description").value.trim();

  if (!from || !to || !amount || !date) {
    showToast("Please fill in all required fields.", "error");
    return;
  }

  if (from === to) {
    showToast("Source and destination wallets must be different.", "error");
    return;
  }

  const debitTx = {
    id: generateId(),
    date,
    wallet: from,
    type: "expense",
    category: "Transfer",
    description: desc || `Transfer to ${to}`,
    amount,
    currency,
    createdTime: new Date().toISOString(),
  };

  const creditTx = {
    id: generateId(),
    date,
    wallet: to,
    type: "income",
    category: "Transfer",
    description: desc || `Transfer from ${from}`,
    amount,
    currency,
    createdTime: new Date().toISOString(),
  };

  await saveTransaction(debitTx);
  await saveTransaction(creditTx);

  closeModal("modal-transfer");
  showToast(
    `Transfer of ${formatAmount(amount, currency)} completed.`,
    "success",
  );
}

// ============================================================
// 15. MODALS
// ============================================================
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
  document.body.style.overflow = "";
}

function closeModalOutside(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

function populateWalletOptions(selectId, currentValue = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const opts = STATE.wallets
    .map(
      (w) =>
        `<option value="${escHtml(w)}" ${w === currentValue ? "selected" : ""}>${escHtml(w)}</option>`,
    )
    .join("");
  sel.innerHTML = `<option value="">Select wallet</option>${opts}`;
}

function populateCategoryOptions(selectId, currentValue = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const opts = STATE.categories
    .map(
      (c) =>
        `<option value="${escHtml(c)}" ${c === currentValue ? "selected" : ""}>${escHtml(c)}</option>`,
    )
    .join("");
  sel.innerHTML = `<option value="">Select category</option>${opts}`;
}

function openTransactionModal(tx = null, presetDate = null) {
  const isEdit = !!tx;
  document.getElementById("modal-transaction-title").textContent = isEdit
    ? "Edit Transaction"
    : "Add Transaction";
  document.getElementById("tx-id").value = tx?.id || "";
  document.getElementById("tx-amount").value = tx?.amount || "";
  document.getElementById("tx-currency").value = tx?.currency || STATE.currency;
  document.getElementById("tx-date").value = tx?.date || presetDate || getTodayISO();
  document.getElementById("tx-description").value = tx?.description || "";
  document.getElementById("tx-recurring").checked = tx?.recurring || false;
  document
    .getElementById("recurring-options")
    .classList.toggle("hidden", !tx?.recurring);
  document.getElementById("tx-recurring-freq").value =
    tx?.recurringFreq || "monthly";

  const txType = tx?.type || "expense";
  setTxType(txType);
  updateTxCurrencySymbol();
  populateWalletOptions("tx-wallet", tx?.wallet || "");
  populateCategoryOptions("tx-category", tx?.category || "");

  document.getElementById("err-amount").textContent = "";
  document.getElementById("err-wallet").textContent = "";

  openModal("modal-transaction");
}

function openEditTransaction(id) {
  const tx = STATE.transactions.find((t) => t.id === id);
  if (tx) openTransactionModal(tx);
}

function setTxType(type) {
  const tabs = document.querySelectorAll(".form-tab");
  tabs.forEach((t) => {
    t.classList.toggle("active", t.dataset.type === type);
  });
  const hiddenType = document.getElementById("tx-id");
  hiddenType.dataset.type = type;
}

function getCurrentTxType() {
  return document.querySelector(".form-tab.active")?.dataset.type || "expense";
}

function updateTxCurrencySymbol() {
  const cur = document.getElementById("tx-currency")?.value || STATE.currency;
  const symbol = document.getElementById("tx-currency-symbol");
  if (symbol) symbol.textContent = getCurrencySymbol(cur);
}

function toggleRecurring() {
  const checked = document.getElementById("tx-recurring").checked;
  document
    .getElementById("recurring-options")
    .classList.toggle("hidden", !checked);
}

async function submitTransaction(event) {
  event.preventDefault();

  const amount = parseFloat(document.getElementById("tx-amount").value);
  const wallet = document.getElementById("tx-wallet").value;

  let valid = true;
  if (!amount || amount <= 0) {
    document.getElementById("err-amount").textContent = "Enter a valid amount.";
    valid = false;
  } else {
    document.getElementById("err-amount").textContent = "";
  }
  if (!wallet) {
    document.getElementById("err-wallet").textContent = "Select a wallet.";
    valid = false;
  } else {
    document.getElementById("err-wallet").textContent = "";
  }
  if (!valid) return;

  const id = document.getElementById("tx-id").value;
  const currency = document.getElementById("tx-currency").value;
  const date = document.getElementById("tx-date").value;
  const description = document.getElementById("tx-description").value.trim();
  const category = document.getElementById("tx-category").value;
  const recurring = document.getElementById("tx-recurring").checked;
  const recurringFreq = document.getElementById("tx-recurring-freq").value;
  const type = getCurrentTxType();

  const txData = {
    id: id || generateId(),
    date,
    wallet,
    type,
    category,
    description,
    amount,
    currency,
    recurring,
    recurringFreq: recurring ? recurringFreq : undefined,
    createdTime: id
      ? STATE.transactions.find((t) => t.id === id)?.createdTime ||
        new Date().toISOString()
      : new Date().toISOString(),
  };

  const btn = document.getElementById("btn-save-tx");
  btn.textContent = "Saving...";
  btn.disabled = true;

  await saveTransaction(txData);
  closeModal("modal-transaction");
  showToast(id ? "Transaction updated." : "Transaction added.", "success");

  btn.textContent = "Save";
  btn.disabled = false;
}

function openWalletModal(editName = null) {
  const title = document.getElementById("modal-wallet-title");
  const input = document.getElementById("wallet-name-input");
  const hidden = document.getElementById("wallet-edit-name");

  title.textContent = editName ? "Edit Wallet" : "Add Wallet";
  input.value = editName || "";
  hidden.value = editName || "";
  document.getElementById("err-wallet-name").textContent = "";

  openModal("modal-wallet");
}

async function submitWallet(event) {
  event.preventDefault();
  const name = document.getElementById("wallet-name-input").value;
  const oldName = document.getElementById("wallet-edit-name").value || null;
  const errEl = document.getElementById("err-wallet-name");

  if (!name.trim()) {
    errEl.textContent = "Enter a wallet name.";
    return;
  }
  errEl.textContent = "";

  const ok = await saveWallet(name.trim(), oldName || null);
  if (ok === false) return;

  closeModal("modal-wallet");
  showToast(oldName ? "Wallet updated." : "Wallet added.", "success");
  refreshCurrentPage();
}

function openCategoryModal(editName = null) {
  const title = document.getElementById("modal-category-title");
  const input = document.getElementById("category-name-input");
  const hidden = document.getElementById("category-edit-name");

  title.textContent = editName ? "Edit Category" : "Add Category";
  input.value = editName || "";
  hidden.value = editName || "";
  document.getElementById("err-category-name").textContent = "";

  openModal("modal-category");
}

async function submitCategory(event) {
  event.preventDefault();
  const name = document.getElementById("category-name-input").value;
  const oldName = document.getElementById("category-edit-name").value || null;
  const errEl = document.getElementById("err-category-name");

  if (!name.trim()) {
    errEl.textContent = "Enter a category name.";
    return;
  }
  errEl.textContent = "";

  const ok = await saveCategory(name.trim(), oldName || null);
  if (ok === false) return;

  closeModal("modal-category");
  showToast(oldName ? "Category updated." : "Category added.", "success");
  refreshCurrentPage();
}

function openTransferModal() {
  populateWalletOptions("transfer-from");
  populateWalletOptions("transfer-to");
  document.getElementById("transfer-amount").value = "";
  document.getElementById("transfer-currency").value = STATE.currency;
  document.getElementById("transfer-date").value = getTodayISO();
  document.getElementById("transfer-description").value = "";
  openModal("modal-transfer");
}

let _confirmCallback = null;
function openConfirmModal(title, message, onConfirm) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  _confirmCallback = onConfirm;
  openModal("modal-confirm");
}

function confirmDelete(type, id, name) {
  let title = "Delete Transaction";
  let message = `Delete "${name}"? This cannot be undone.`;

  if (type === "wallet") {
    title = "Delete Wallet";
    message = `Delete wallet "${name}"? Transactions linked to this wallet will remain but show no wallet.`;
  } else if (type === "category") {
    title = "Delete Category";
    message = `Delete category "${name}"? Transactions with this category will remain uncategorized.`;
  }

  openConfirmModal(title, message, async () => {
    closeModal("modal-confirm");
    if (type === "transaction") await deleteTransaction(id);
    else if (type === "wallet") await deleteWallet(id);
    else if (type === "category") await deleteCategory(id);
    showToast(
      `${type.charAt(0).toUpperCase() + type.slice(1)} deleted.`,
      "success",
    );
  });
}

function clearFilters() {
  document.getElementById("filter-wallet").value = "";
  document.getElementById("filter-type").value = "";
  document.getElementById("filter-category").value = "";
  document.getElementById("filter-date-from").value = "";
  document.getElementById("filter-date-to").value = "";
  renderTransactionsList();
}

// ============================================================
// 16. TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon =
    { success: "✓", error: "✕", info: "ℹ", warning: "⚠" }[type] || "ℹ";
  toast.innerHTML = `<span>${icon}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================================
// 17. NAVIGATION
// ============================================================
function navigate(page) {
  if (STATE.currentPage === page) return;
  STATE.currentPage = page;

  // Update page visibility
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${page}`)?.classList.add("active");

  // Update sidebar nav
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
  });

  // Update bottom nav
  document.querySelectorAll(".bottom-nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
  });

  // Update page title
  const titles = {
    dashboard: "Dashboard",
    wallets: "Wallets",
    transactions: "Transactions",
    calendar: "Calendar",
    reports: "Reports",
    settings: "Settings",
  };
  document.getElementById("page-title").textContent = titles[page] || page;

  // Close mobile sidebar
  closeMobileSidebar();

  // Render content
  renderPage(page);
}

function renderPage(page) {
  if (page === "dashboard") renderDashboard();
  else if (page === "wallets") renderWallets();
  else if (page === "transactions") {
    populateFilterOptions();
    renderTransactionsList();
  } else if (page === "reports") {
    renderReports();
  } else if (page === "calendar") {
    renderCalendar();
  } else if (page === "settings") {
    renderSettingsLists();
  }
}

function refreshCurrentPage() {
  renderPage(STATE.currentPage);
}

function populateFilterOptions() {
  const walletSel = document.getElementById("filter-wallet");
  const catSel = document.getElementById("filter-category");
  if (!walletSel || !catSel) return;

  const currentWallet = walletSel.value;
  const currentCat = catSel.value;

  walletSel.innerHTML = `<option value="">All Wallets</option>${STATE.wallets
    .map(
      (w) =>
        `<option value="${escHtml(w)}" ${w === currentWallet ? "selected" : ""}>${escHtml(w)}</option>`,
    )
    .join("")}`;
  catSel.innerHTML = `<option value="">All Categories</option>${STATE.categories
    .map(
      (c) =>
        `<option value="${escHtml(c)}" ${c === currentCat ? "selected" : ""}>${escHtml(c)}</option>`,
    )
    .join("")}`;
}

// ============================================================
// 18. THEME
// ============================================================
const THEME_PRESETS = {
  original: "#4f46e5",
  royal: "#4338ca",
  ocean: "#1d4ed8",
  wealth: "#0f766e",
  gold: "#b45309",
  berry: "#be123c",
};

function shadeHex(hex, percent) {
  const value = parseInt(hex.slice(1), 16);
  const amount = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (value >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((value >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (value & 0xff) + amount));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function applyAccentTheme() {
  const color = STATE.themePreset === "custom"
    ? STATE.customThemeColor
    : THEME_PRESETS[STATE.themePreset] || THEME_PRESETS.original;
  const root = document.documentElement;
  const numericColor = parseInt(color.slice(1), 16);
  const accentRgb = `${numericColor >> 16} ${(numericColor >> 8) & 0xff} ${numericColor & 0xff}`;
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-rgb", accentRgb);
  root.style.setProperty("--accent-hover", shadeHex(color, STATE.theme === "dark" ? 12 : -10));
  root.style.setProperty("--accent-light", `${color}${STATE.theme === "dark" ? "28" : "16"}`);
  document.querySelectorAll(".theme-preset").forEach((button) =>
    button.classList.toggle("active", button.dataset.preset === STATE.themePreset));
  const picker = document.getElementById("custom-theme-color");
  const hexInput = document.getElementById("custom-theme-hex");
  if (picker) picker.value = STATE.customThemeColor;
  if (hexInput) hexInput.value = STATE.customThemeColor;
}

function setThemePreset(preset) {
  if (!THEME_PRESETS[preset]) return;
  STATE.themePreset = preset;
  persistSettings();
  applyAccentTheme();
  refreshCurrentPage();
}

function saveCustomTheme() {
  const hexInput = document.getElementById("custom-theme-hex");
  const picker = document.getElementById("custom-theme-color");
  const color = (hexInput?.value || picker?.value || "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) {
    showToast("Enter a valid six-digit color such as #7c3aed.", "warning");
    return;
  }
  STATE.customThemeColor = color.toLowerCase();
  STATE.themePreset = "custom";
  persistSettings();
  applyAccentTheme();
  refreshCurrentPage();
  showToast(`Custom theme applied: ${STATE.customThemeColor}`, "success");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  STATE.theme = theme;
  persistSettings();
  applyAccentTheme();
  document.getElementById("appearance-light")?.classList.toggle("active", theme === "light");
  document.getElementById("appearance-dark")?.classList.toggle("active", theme === "dark");
}

function setAppearanceMode(theme) {
  if (theme !== "light" && theme !== "dark") return;
  applyTheme(theme);
  if (STATE.currentPage === "dashboard") renderBalanceChart();
  if (STATE.currentPage === "reports") renderReports();
}

function toggleTheme() {
  applyTheme(STATE.theme === "light" ? "dark" : "light");
  // Re-render charts for color update
  if (STATE.currentPage === "dashboard") renderBalanceChart();
  if (STATE.currentPage === "reports") renderReports();
}

function closeMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.querySelector(".sidebar-overlay");
  sidebar?.classList.remove("mobile-open");
  overlay?.classList.remove("active");
}

function openMobileSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.querySelector(".sidebar-overlay");
  sidebar?.classList.add("mobile-open");
  overlay?.classList.add("active");
}

// ============================================================
// FEEDBACK
// ============================================================
let pendingFeedbackScreenshot = null;

function compressFeedbackImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Unsupported image"));
      image.onload = () => {
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          data: canvas.toDataURL("image/jpeg", 0.82),
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFeedbackScreenshot(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const preview = document.getElementById("feedback-screenshot-preview");
  if (file.size > 12 * 1024 * 1024) {
    showToast("Please choose a screenshot smaller than 12 MB.", "warning");
    event.target.value = "";
    return;
  }
  try {
    pendingFeedbackScreenshot = await compressFeedbackImage(file);
    preview.classList.remove("hidden");
    preview.innerHTML = `<img src="${pendingFeedbackScreenshot.data}" alt="Screenshot preview"><div><span>${escHtml(file.name)}</span><button type="button" onclick="removeFeedbackScreenshot()">Remove</button></div>`;
  } catch {
    showToast("That screenshot could not be processed.", "error");
  }
}

function removeFeedbackScreenshot() {
  pendingFeedbackScreenshot = null;
  const input = document.getElementById("feedback-screenshot");
  const preview = document.getElementById("feedback-screenshot-preview");
  if (input) input.value = "";
  if (preview) {
    preview.innerHTML = "";
    preview.classList.add("hidden");
  }
}

function openFeedbackModal() {
  document.getElementById("feedback-error").textContent = "";
  renderFeedbackHistory();
  openModal("modal-feedback");
  setTimeout(() => document.getElementById("feedback-message")?.focus(), 250);
}

function renderFeedbackHistory() {
  const container = document.getElementById("feedback-history");
  if (!container) return;
  const items = [...STATE.feedback].sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  if (!items.length) {
    container.innerHTML = '<p class="feedback-empty">No feedback sent yet.</p>';
    return;
  }
  container.innerHTML = items.map((item) => {
    const withdrawn = item.status === "withdrawn";
    return `<article class="feedback-entry ${withdrawn ? "withdrawn" : ""}">
      <div class="feedback-entry-head">
        <span class="feedback-type">${escHtml(item.type)}</span>
        <span class="feedback-status">${withdrawn ? "Withdrawn" : item.status === "sent" ? "Sent" : "Saved locally"}</span>
      </div>
      <p>${escHtml(item.message)}</p>
      ${item.attachmentUrl ? `<a class="feedback-attachment-link" href="${escHtml(item.attachmentUrl)}" target="_blank" rel="noopener">View attached screenshot</a>` : ""}
      <div class="feedback-entry-foot">
        <time>${new Date(item.createdTime).toLocaleString()}</time>
        <div class="feedback-entry-actions">
          ${withdrawn ? '<span class="withdrawn-mark">This feedback was undone</span>' : `<button onclick="undoFeedback('${item.id}')">Undo send</button>`}
          <button class="feedback-delete" onclick="deleteFeedbackRecord('${item.id}')">Delete</button>
        </div>
      </div>
    </article>`;
  }).join("");
}

async function submitFeedback(event) {
  event.preventDefault();
  const messageInput = document.getElementById("feedback-message");
  const message = messageInput.value.trim();
  if (!message) {
    document.getElementById("feedback-error").textContent = "Please enter your feedback.";
    return;
  }
  if (pendingFeedbackScreenshot && (!STATE.gasUrl || !STATE.isOnline)) {
    showToast("Connect to Google Sheets and go online to share a screenshot.", "warning");
    return;
  }
  const feedback = {
    id: generateId(),
    userId: STATE.installationId,
    type: document.getElementById("feedback-type").value,
    message,
    page: STATE.currentPage,
    status: "local",
    createdTime: new Date().toISOString(),
    withdrawnTime: "",
    attachmentUrl: "",
  };
  STATE.feedback.push(feedback);
  persistFeedback();
  messageInput.value = "";
  document.getElementById("feedback-count").textContent = "0 / 1000";
  const screenshot = pendingFeedbackScreenshot;
  if (!screenshot) removeFeedbackScreenshot();
  renderFeedbackHistory();

  if (STATE.gasUrl && STATE.isOnline) {
    try {
      const response = await apiSaveFeedback({
        ...feedback,
        attachmentData: screenshot?.data || "",
        attachmentName: screenshot?.name || "",
      });
      if (!response.success) throw new Error(response.error || "Feedback was not accepted");
      feedback.status = "sent";
      feedback.attachmentUrl = response.data?.attachmentUrl || "";
      removeFeedbackScreenshot();
      persistFeedback();
      renderFeedbackHistory();
    } catch {}
  }
  const preview = `${message.slice(0, 70)}${message.length > 70 ? "…" : ""}`;
  showToast(`Feedback received: “${preview}”`, "success");
}

async function undoFeedback(id) {
  const item = STATE.feedback.find((feedback) => feedback.id === id);
  if (!item || item.status === "withdrawn") return;
  item.status = "withdrawn";
  item.withdrawnTime = new Date().toISOString();
  persistFeedback();
  renderFeedbackHistory();
  if (STATE.gasUrl && STATE.isOnline) {
    try {
      const response = await apiWithdrawFeedback(id);
      if (!response.success) throw new Error(response.error || "Withdrawal was not accepted");
    } catch {}
  }
  showToast("Feedback undone. A withdrawn record remains in your history.", "info");
}

async function deleteFeedbackRecord(id) {
  const item = STATE.feedback.find((feedback) => feedback.id === id);
  if (!item) return;
  STATE.feedback = STATE.feedback.filter((feedback) => feedback.id !== id);
  persistFeedback();
  renderFeedbackHistory();
  if (STATE.gasUrl && STATE.isOnline) {
    try {
      const response = await apiDeleteFeedback(id);
      if (!response.success) throw new Error(response.error || "Delete was not accepted");
    } catch {
      showToast("Deleted locally. Cloud deletion will require an active connection.", "warning");
      queueOperation({ action: "deleteFeedback", id });
      return;
    }
  } else if (STATE.gasUrl) {
    queueOperation({ action: "deleteFeedback", id });
  }
  showToast(`Deleted feedback: “${item.message.slice(0, 50)}${item.message.length > 50 ? "…" : ""}”`, "info");
}

async function syncFeedbackHistory() {
  if (!STATE.gasUrl || !STATE.isOnline) return;
  try {
    const response = await apiGetFeedback();
    if (response.success && Array.isArray(response.data)) {
      const pendingDeletes = new Set(STATE.pendingQueue
        .filter((operation) => operation.action === "deleteFeedback")
        .map((operation) => operation.id));
      const localById = new Map(STATE.feedback.map((item) => [item.id, item]));
      response.data.forEach((item) => {
        if (pendingDeletes.has(item.id)) return;
        const local = localById.get(item.id);
        if (!local || local.status !== "withdrawn") localById.set(item.id, item);
      });
      STATE.feedback = [...localById.values()];
      persistFeedback();
      renderFeedbackHistory();
    }
  } catch {}
}

// ============================================================
// 19. EVENT LISTENERS & INITIALIZATION
// ============================================================
function ensureDefaults() {
  if (!STATE.wallets.length) {
    STATE.wallets = ["Personal", "Other"];
    persistWallets();
  }
  if (!STATE.categories.length) {
    STATE.categories = [
      "Food",
      "Transport",
      "Housing",
      "Entertainment",
      "Shopping",
      "Health",
      "Salary",
      "Other",
    ];
    persistCategories();
  }
}

function applyDemoState() {
  const today = new Date();
  const date = (daysAgo) => {
    const value = new Date(today);
    value.setDate(value.getDate() - daysAgo);
    return formatLocalISODate(value);
  };
  STATE.gasUrl = "";
  STATE.pendingQueue = [];
  STATE.lastSynced = null;
  STATE.isSyncing = false;
  STATE.wallets = ["Everyday", "Savings", "Travel"];
  STATE.categories = ["Salary", "Food", "Transport", "Housing", "Health", "Leisure"];
  STATE.transactions = [
    { id:"demo1", date:date(17), wallet:"Everyday", type:"income", category:"Salary", description:"Monthly salary", amount:8500000, currency:"IDR", createdTime:new Date().toISOString() },
    { id:"demo2", date:date(14), wallet:"Everyday", type:"expense", category:"Housing", description:"Rent", amount:2400000, currency:"IDR", createdTime:new Date().toISOString() },
    { id:"demo3", date:date(10), wallet:"Everyday", type:"expense", category:"Food", description:"Groceries", amount:725000, currency:"IDR", createdTime:new Date().toISOString() },
    { id:"demo4", date:date(7), wallet:"Travel", type:"expense", category:"Leisure", description:"Travel booking", amount:95, currency:"USD", createdTime:new Date().toISOString() },
    { id:"demo5", date:date(4), wallet:"Everyday", type:"expense", category:"Transport", description:"Fuel and parking", amount:390000, currency:"IDR", createdTime:new Date().toISOString() },
    { id:"demo6", date:date(2), wallet:"Savings", type:"income", category:"Salary", description:"Freelance project", amount:2100000, currency:"IDR", createdTime:new Date().toISOString() },
  ];
  const banner = document.createElement("div");
  banner.className = "demo-banner";
  banner.innerHTML = '<span><strong>Demo mode</strong> — changes reset when you leave.</span><a href="/">Exit demo</a>';
  document.body.prepend(banner);
  document.body.classList.add("demo-mode");
}

function initEventListeners() {
  // Sidebar nav
  document.querySelectorAll(".nav-item, .bottom-nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(item.dataset.page);
    });
  });

  // Theme toggle
  document
    .getElementById("theme-toggle")
    ?.addEventListener("click", toggleTheme);

  // Sidebar collapse
  document.getElementById("sidebar-collapse")?.addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("collapsed");
  });

  // Mobile sidebar toggle
  document
    .getElementById("sidebar-toggle-mobile")
    ?.addEventListener("click", openMobileSidebar);

  // Sidebar overlay
  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  overlay.addEventListener("click", closeMobileSidebar);
  document.body.appendChild(overlay);

  // Confirm modal action
  document
    .getElementById("btn-confirm-action")
    ?.addEventListener("click", () => {
      if (_confirmCallback) _confirmCallback();
    });

  // Currency select in topbar
  document
    .getElementById("currency-select")
    ?.addEventListener("change", (e) => {
      saveCurrency(e.target.value);
    });

  // Dashboard quick dates
  document.querySelectorAll(".quick-date").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".quick-date")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      STATE.dashRange = btn.dataset.range;
      renderDashboard();
    });
  });

  // Filters
  [
    "filter-wallet",
    "filter-type",
    "filter-category",
    "filter-date-from",
    "filter-date-to",
  ].forEach((id) => {
    document
      .getElementById(id)
      ?.addEventListener("change", renderTransactionsList);
    document
      .getElementById(id)
      ?.addEventListener("input", renderTransactionsList);
  });

  // Report month/year
  document
    .getElementById("report-month")
    ?.addEventListener("change", renderReports);
  document
    .getElementById("report-year")
    ?.addEventListener("change", renderReports);

  // Sync indicator click
  document.getElementById("sync-indicator")?.addEventListener("click", syncNow);

  document.getElementById("feedback-message")?.addEventListener("input", (event) => {
    document.getElementById("feedback-count").textContent = `${event.target.value.length} / 1000`;
  });
  document.getElementById("custom-theme-color")?.addEventListener("input", (event) => {
    document.getElementById("custom-theme-hex").value = event.target.value;
  });

  // Keyboard close modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay.open").forEach((m) => {
        closeModal(m.id);
      });
    }
  });

  // Online/offline
  window.addEventListener("online", () => {
    STATE.isOnline = true;
    updateSyncDisplay();
    showToast("Back online. Syncing pending changes...", "info");
    drainPendingQueue().then(() => {
      if (STATE.pendingQueue.length === 0 && STATE.gasUrl) syncNow();
    });
  });

  window.addEventListener("offline", () => {
    STATE.isOnline = false;
    updateSyncDisplay();
    showToast(
      "You are offline. Changes will sync when reconnected.",
      "warning",
    );
  });
}

// Global exports for HTML onclick handlers
window.navigate = navigate;
window.openTransactionModal = openTransactionModal;
window.openTransactionForDate = openTransactionForDate;
window.openQuickTransaction = openQuickTransaction;
window.selectCalendarDate = selectCalendarDate;
window.changeCalendarMonth = changeCalendarMonth;
window.goCalendarToday = goCalendarToday;
window.openEditTransaction = openEditTransaction;
window.openWalletModal = openWalletModal;
window.openCategoryModal = openCategoryModal;
window.openTransferModal = openTransferModal;
window.closeModal = closeModal;
window.closeModalOutside = closeModalOutside;
window.submitTransaction = submitTransaction;
window.submitWallet = submitWallet;
window.submitCategory = submitCategory;
window.submitTransfer = submitTransfer;
window.setTxType = setTxType;
window.updateTxCurrencySymbol = updateTxCurrencySymbol;
window.toggleRecurring = toggleRecurring;
window.confirmDelete = confirmDelete;
window.clearFilters = clearFilters;
window.exportCSV = exportCSV;
window.importCSV = importCSV;
window.saveGASUrl = saveGASUrl;
window.saveCurrency = saveCurrency;
window.addFavoriteCurrency = addFavoriteCurrency;
window.removeFavoriteCurrency = removeFavoriteCurrency;
window.testConnection = testConnection;
window.confirmReset = confirmReset;
window.syncNow = syncNow;
window.openFeedbackModal = openFeedbackModal;
window.submitFeedback = submitFeedback;
window.undoFeedback = undoFeedback;
window.deleteFeedbackRecord = deleteFeedbackRecord;
window.setThemePreset = setThemePreset;
window.saveCustomTheme = saveCustomTheme;
window.setAppearanceMode = setAppearanceMode;
window.handleFeedbackScreenshot = handleFeedbackScreenshot;
window.removeFeedbackScreenshot = removeFeedbackScreenshot;

// ============================================================
// BOOT
// ============================================================
function boot() {
  loadStateFromLS();
  if (IS_DEMO_MODE) applyDemoState();
  ensureDefaults();
  applyTheme(STATE.theme);

  populateCurrencySelects();
  document.getElementById("currency-select").value = STATE.currency;
  document.getElementById("settings-currency").value = STATE.currency;

  updateGasBanner();
  updateSyncDisplay();
  initReportSelects();
  initEventListeners();

  // Check recurring on startup
  checkRecurringTransactions();

  // Render initial page
  renderPage("dashboard");
  updateExchangeRates();
  syncFeedbackHistory();

  // Auto-sync on startup if online and GAS URL is set
  if (!IS_DEMO_MODE && STATE.gasUrl && STATE.isOnline) {
    setTimeout(syncNow, 1200);
  }
}

document.addEventListener("DOMContentLoaded", boot);
