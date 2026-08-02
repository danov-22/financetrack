// ============================================================
// PERSONAL FINANCE DASHBOARD — script.js
// ============================================================

// ============================================================
// APP STATE
// ============================================================
const app = {
  transactions: [],      // all transactions loaded from Sheets
  settings: {
    scriptUrl:  'https://script.google.com/macros/s/AKfycbwMdx1fuYEwhruAxj-qZxknQVf1tifgYSk-1gB8PYjUF8M22bvnnkGpiZlBx4SGobQz/exec',
    currency:   'IDR',
    wallets:    ['Personal Wallet', 'Other Wallet'],
    categories: ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Investment', 'Other']
  },
  filters: {
    search:      '',
    type:        'all',
    wallet:      'all',
    category:    'all',
    sortBy:      'newest',
    dateFrom:    '',
    dateTo:      '',
    quickFilter: 'all'
  },
  currentPage:    'dashboard',
  editingTxId:    null,      // id of transaction being edited
  deletingTxId:   null,      // id of transaction pending delete
  txPage:         1,
  txPerPage:      20,
  charts: { balance: null, incomeExpense: null, category: null }
};

// ============================================================
// LOCALSTORAGE HELPERS
// ============================================================
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function load(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}

function loadSettings() {
  const saved = load('finance_settings');
  if (saved) app.settings = { ...app.settings, ...saved };
  const savedCurrency = load('currency', app.settings.currency || 'IDR');
  app.settings.currency = (savedCurrency || app.settings.currency || 'IDR').toUpperCase();
  currentCurrency = app.settings.currency;
}
function saveSettings() {
  app.settings.currency = (app.settings.currency || currentCurrency || 'IDR').toUpperCase();
  save('finance_settings', app.settings);
  save('currency', app.settings.currency);
}
function loadCache()   { app.transactions = load('finance_cache', []); }
function saveCache()   { save('finance_cache', app.transactions); }

// ============================================================
// GOOGLE SHEETS API
// ============================================================
async function syncFromSheets() {
  if (!app.settings.scriptUrl) { showBanner(); return; }
  showToast('Syncing with Google Sheets…');
  try {
    const res  = await fetch(app.settings.scriptUrl + '?action=getAll');
    const data = await res.json();
    if (data.transactions) {
      app.transactions = data.transactions.map(normalizeTx);
      saveCache();
      renderCurrentPage();
      updateLastSyncTime();
      showToast('Synced successfully!', 'success');
    } else {
      showToast('Unexpected response from Sheets.', 'error');
    }
  } catch (e) {
    showToast('Sync failed. Using cached data.', 'error');
  }
}

async function pushAddToSheets(tx) {

  if (!app.settings.scriptUrl) return;

  try {

    const response = await fetch(app.settings.scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({
        action: 'add',
        ...tx
      })
    });

    const result = await response.text();

    console.log("Google response:", result);

  } catch(error) {
    console.error("Google error:", error);
  }

}

async function pushUpdateToSheets(tx) {
  if (!app.settings.scriptUrl) return;
  try {
    await fetch(app.settings.scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({
        action: 'update',
        ...tx
      })
    });
  } catch(error){
    console.error("Sync error:", error);
    showToast("Cloud sync failed", "error");
  }
}

async function pushDeleteToSheets(id) {
  if (!app.settings.scriptUrl) return;
  try {
    await fetch(app.settings.scriptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({ action: 'delete', id })
    });
  } catch(error){
    console.error("Sync error:", error);
    showToast("Cloud sync failed", "error");
  }
}

function updateLastSyncTime(){

  const now = new Date();

  const formatted = now.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const element = document.getElementById("lastSync");

  if(element){
    element.innerHTML = `☁️ Synced: ${formatted}`;
  }
  localStorage.setItem("lastSync", formatted);

}

function loadLastSync(){
  const saved = localStorage.getItem("lastSync");
  const element = document.getElementById("lastSync");
  if(saved && element){
    element.innerHTML = `☁️ Synced: ${saved}`;
  }

}

async function syncSettingsFromSheets(){
  if (!app.settings.scriptUrl) return;
  try {
    const res = await fetch(
      app.settings.scriptUrl + '?action=getSettings'
    );
    const data = await res.json();

    if(data.wallets){
      app.settings.wallets = data.wallets;
    }

    if(data.categories){
      app.settings.categories = data.categories;
    }
    saveCache();
    renderSettings();
  }

  catch(error){
    console.error("Settings sync failed:", error);
  }
}

// Normalize a transaction object (ensure all fields exist)
function normalizeTx(tx) {
  return {
    id:          String(tx.id || generateId()),
    date:        tx.date || todayStr(),
    wallet:      tx.wallet || app.settings.wallets[0],
    type:        tx.type || 'Expense',
    category:    tx.category || 'Other',
    description: tx.description || '',
    amount:      parseFloat(tx.amount) || 0,
    currency:    tx.currency || "IDR",
    createdTime: tx.createdTime || new Date().toISOString()
  };
}

// ============================================================
// NAVIGATION
// ============================================================
const PAGE_TITLES = {
  dashboard:    'Dashboard',
  wallets:      'Wallets',
  transactions: 'Transactions',
  reports:      'Reports',
  settings:     'Settings'
};

function showPage(name) {
  app.currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');

  // Sidebar links
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === name);
  });
  // Bottom nav links
  document.querySelectorAll('.bottom-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === name);
  });

  document.getElementById('pageTitle').textContent = PAGE_TITLES[name] || '';
  closeSidebar();
  renderCurrentPage();
}

function renderCurrentPage() {
  if (app.currentPage === 'dashboard')    renderDashboard();
  else if (app.currentPage === 'wallets') renderWallets();
  else if (app.currentPage === 'transactions') renderTransactions();
  else if (app.currentPage === 'reports') renderReports();
  else if (app.currentPage === 'settings') renderSettings();
}

// ============================================================
// FINANCE CALCULATIONS
// ============================================================
function getWalletBalance(walletName) {
  let balance = 0;
  for (const tx of app.transactions) {
    if (tx.type === 'Income'   && tx.wallet === walletName) balance += tx.amount;
    if (tx.type === 'Expense'  && tx.wallet === walletName) balance -= tx.amount;
    if (tx.type === 'Transfer' && tx.wallet === walletName) balance += tx.amount;
    // Transfers stored as: positive = destination, negative = source (by convention)
    // We handle both directions via the description convention in saveTransfer()
  }
  return balance;
}

function getWalletStats(walletName) {
  let income = 0, expenses = 0;
  for (const tx of app.transactions) {
    if (tx.wallet !== walletName) continue;
    if (tx.type === 'Income')  income   += tx.amount;
    if (tx.type === 'Expense') expenses += tx.amount;
    if (tx.type === 'Transfer' && tx.amount > 0) income   += tx.amount;
    if (tx.type === 'Transfer' && tx.amount < 0) expenses += Math.abs(tx.amount);
  }
  return { income, expenses, balance: income - expenses };
}

function getTotalBalance() {
  return app.settings.wallets.reduce((sum, w) => sum + getWalletBalance(w), 0);
}

function getMonthlyStats(year, month) {
  const txs = app.transactions.filter(tx => {
    const d = new Date(tx.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  let income = 0, expenses = 0;
  for (const tx of txs) {
    if (tx.type === 'Income')  income   += tx.amount;
    if (tx.type === 'Expense') expenses += tx.amount;
  }
  return { income, expenses, savings: income - expenses, transactions: txs };
}

// ============================================================
// DASHBOARD PAGE
// ============================================================
function renderDashboard() {
  const now = new Date();

  // Show/hide banner
  showBanner();

  // Total balance
  document.getElementById('totalBalance').textContent = fmt(getTotalBalance());

  // Wallet cards
  const grid = document.getElementById('walletCardsGrid');
  grid.innerHTML = '';
  for (const wallet of app.settings.wallets) {
    const stats = getWalletStats(wallet);
    const card  = document.createElement('div');
    card.className = 'wallet-card';
    card.innerHTML = `
      <div class="wallet-card-name">${esc(wallet)}</div>
      <div class="wallet-card-balance">${fmt(stats.balance)}</div>
      <div class="wallet-card-stats">
        <div class="wallet-stat">
          <div class="wallet-stat-label">Income</div>
          <div class="wallet-stat-value positive">${fmt(stats.income)}</div>
        </div>
        <div class="wallet-stat">
          <div class="wallet-stat-label">Expenses</div>
          <div class="wallet-stat-value negative">${fmt(stats.expenses)}</div>
        </div>
      </div>`;
    grid.appendChild(card);
  }

  // Monthly summary
  const ms = getMonthlyStats(now.getFullYear(), now.getMonth());
  document.getElementById('monthIncome').textContent   = fmt(ms.income);
  document.getElementById('monthExpenses').textContent = fmt(ms.expenses);
  const savEl = document.getElementById('monthSavings');
  savEl.textContent = fmt(ms.savings);
  savEl.className   = 'stat-value ' + (ms.savings >= 0 ? 'positive' : 'negative');

  // Recent transactions (last 10)
  const recent = [...app.transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);
  const list = document.getElementById('recentTransactionsList');
  if (recent.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-title">No transactions yet</div><p>Add your first transaction to get started.</p></div>';
  } else {
    list.innerHTML = '<div class="tx-list">' + recent.map(txHTML).join('') + '</div>';
    list.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
    list.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
    });
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openDeleteModal(btn.dataset.id); });
    });
  }
}

function txHTML(tx) {
  const typeClass = tx.type.toLowerCase();
  const sign = tx.type === 'Income' ? '+' : (tx.type === 'Transfer' ? '↔' : '-');
  const amtClass = tx.type === 'Income' ? 'positive' : (tx.type === 'Expense' ? 'negative' : '');
  return `
    <div class="tx-item" data-id="${tx.id}">
      <div class="tx-type-badge ${typeClass}">${tx.type[0]}</div>
      <div class="tx-info">
        <div class="tx-description">${esc(tx.description || tx.category)}</div>
        <div class="tx-meta">${fmtDate(tx.date)} &middot; ${esc(tx.wallet)} &middot; ${esc(tx.category)}</div>
      </div>
      <div class="tx-amount ${amtClass}">${sign}${fmt(Math.abs(tx.amount))}</div>
      <div class="tx-actions">
        <button class="icon-btn edit-btn" data-id="${tx.id}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn delete-btn" data-id="${tx.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>`;
}

// ============================================================
// WALLETS PAGE
// ============================================================
function renderWallets() {
  const container = document.getElementById('walletsList');
  container.innerHTML = '';

  for (const wallet of app.settings.wallets) {
    const stats  = getWalletStats(wallet);
    const txs    = app.transactions
      .filter(tx => tx.wallet === wallet)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5);

    const card = document.createElement('div');
    card.className = 'wallet-detail-card';
    card.innerHTML = `
      <div class="wallet-detail-header">
        <div class="wallet-detail-name">${esc(wallet)}</div>
      </div>
      <div class="wallet-detail-balance">${fmt(stats.balance)}</div>
      <div class="wallet-detail-stats">
        <div class="wallet-stat-box">
          <div class="label">Total Income</div>
          <div class="value positive">${fmt(stats.income)}</div>
        </div>
        <div class="wallet-stat-box">
          <div class="label">Total Expenses</div>
          <div class="value negative">${fmt(stats.expenses)}</div>
        </div>
      </div>
      <div class="wallet-tx-title">Recent Transactions</div>
      <div class="wallet-tx-list">
        ${txs.length === 0 ? '<div class="empty-state">No transactions for this wallet yet.</div>' :
          '<div class="tx-list">' + txs.map(txHTML).join('') + '</div>'}
      </div>`;
    container.appendChild(card);

    // Wire up edit/delete buttons inside wallet cards
    card.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
    card.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
    });
    card.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openDeleteModal(btn.dataset.id); });
    });
  }
}

// ============================================================
// TRANSACTIONS PAGE
// ============================================================
function renderTransactions() {
  populateFilterDropdowns();

  const filtered = getFilteredTransactions();
  const total    = filtered.length;
  const pages    = Math.max(1, Math.ceil(total / app.txPerPage));
  app.txPage     = Math.min(app.txPage, pages);

  const start  = (app.txPage - 1) * app.txPerPage;
  const paged  = filtered.slice(start, start + app.txPerPage);
  const list   = document.getElementById('transactionsList');

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-title">No transactions found</div><p>Try adjusting your filters, or add a new transaction.</p></div>';
  } else {
    list.innerHTML = '<div class="tx-list">' + paged.map(txHTML).join('') + '</div>';
    list.querySelectorAll('.tx-item').forEach(el => {
      el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
    list.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
    });
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); openDeleteModal(btn.dataset.id); });
    });
  }

  // Pagination
  const bar = document.getElementById('paginationBar');
  if (pages <= 1) { bar.innerHTML = ''; return; }
  let html = '<div class="pagination">';
  if (app.txPage > 1) html += `<button class="page-btn" data-p="${app.txPage - 1}">&#8249; Prev</button>`;
  html += `<span class="page-info">Page ${app.txPage} of ${pages} (${total} transactions)</span>`;
  if (app.txPage < pages) html += `<button class="page-btn" data-p="${app.txPage + 1}">Next &#8250;</button>`;
  html += '</div>';
  bar.innerHTML = html;
  bar.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => { app.txPage = +btn.dataset.p; renderTransactions(); });
  });
}

function populateFilterDropdowns() {
  const wSelect = document.getElementById('filterWallet');
  const cSelect = document.getElementById('filterCategory');
  const current = { w: wSelect.value, c: cSelect.value };

  wSelect.innerHTML = '<option value="all">All Wallets</option>' +
    app.settings.wallets.map(w => `<option value="${esc(w)}" ${current.w === w ? 'selected' : ''}>${esc(w)}</option>`).join('');
  cSelect.innerHTML = '<option value="all">All Categories</option>' +
    app.settings.categories.map(c => `<option value="${esc(c)}" ${current.c === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function getFilteredTransactions() {
  let txs = [...app.transactions];

  // Quick date filter
  const today = new Date(); today.setHours(0,0,0,0);
  if (app.filters.quickFilter === 'today') {
    txs = txs.filter(tx => new Date(tx.date) >= today);
  } else if (app.filters.quickFilter === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - 6);
    txs = txs.filter(tx => new Date(tx.date) >= d);
  } else if (app.filters.quickFilter === 'month') {
    txs = txs.filter(tx => {
      const d = new Date(tx.date);
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    });
  } else if (app.filters.quickFilter === 'year') {
    txs = txs.filter(tx => new Date(tx.date).getFullYear() === today.getFullYear());
  } else if (app.filters.quickFilter === 'custom' && app.filters.dateFrom) {
    const from = new Date(app.filters.dateFrom);
    const to   = app.filters.dateTo ? new Date(app.filters.dateTo) : new Date();
    to.setHours(23,59,59);
    txs = txs.filter(tx => { const d = new Date(tx.date); return d >= from && d <= to; });
  }

  // Type filter
  if (app.filters.type !== 'all')     txs = txs.filter(tx => tx.type === app.filters.type);
  if (app.filters.wallet !== 'all')   txs = txs.filter(tx => tx.wallet === app.filters.wallet);
  if (app.filters.category !== 'all') txs = txs.filter(tx => tx.category === app.filters.category);

  // Search
  if (app.filters.search) {
    const q = app.filters.search.toLowerCase();
    txs = txs.filter(tx =>
      tx.description.toLowerCase().includes(q) ||
      tx.category.toLowerCase().includes(q) ||
      tx.wallet.toLowerCase().includes(q) ||
      String(tx.amount).includes(q)
    );
  }

  // Sort
  if (app.filters.sortBy === 'newest')  txs.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (app.filters.sortBy === 'oldest')  txs.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (app.filters.sortBy === 'highest') txs.sort((a, b) => b.amount - a.amount);
  if (app.filters.sortBy === 'lowest')  txs.sort((a, b) => a.amount - b.amount);

  return txs;
}

// ============================================================
// TRANSACTION MODAL (Add / Edit)
// ============================================================
function openAddModal() {
  app.editingTxId = null;
  document.getElementById('modalTitle').textContent = 'Add Transaction';
  document.getElementById('transactionForm').reset();
  document.getElementById('txId').value    = '';
  document.getElementById('txDate').value  = todayStr();
  document.getElementById('txType').value  = 'Expense';
  populateModalDropdowns();
  toggleTransferFields('Expense');
  document.getElementById('transactionModal').showModal();
}

function openEditModal(id) {
  const tx = app.transactions.find(t => t.id === id);
  if (!tx) return;
  app.editingTxId = id;
  document.getElementById('modalTitle').textContent = 'Edit Transaction';
  populateModalDropdowns();
  document.getElementById('txId').value          = tx.id;
  document.getElementById('txDate').value         = tx.date;
  document.getElementById('txType').value         = tx.type;
  document.getElementById('txWallet').value       = tx.wallet;
  document.getElementById('txCategory').value     = tx.category;
  document.getElementById('txDescription').value  = tx.description;
  document.getElementById('txAmount').value       = tx.amount;
  toggleTransferFields(tx.type);
  document.getElementById('transactionModal').showModal();
}

function populateModalDropdowns() {
  ['txWallet', 'txFromWallet', 'txToWallet', 'recWallet', 'transferFrom', 'transferTo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = app.settings.wallets.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('');
  });
  ['txCategory', 'recCategory'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = app.settings.categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  });
}

function toggleTransferFields(type) {
  const isTransfer = type === 'Transfer';
  document.getElementById('walletGroup').style.display   = isTransfer ? 'none' : '';
  document.getElementById('transferGroup').style.display = isTransfer ? '' : 'none';
  document.getElementById('categoryGroup').style.display = isTransfer ? 'none' : '';
}

function closeTransactionModal() {
  document.getElementById('transactionModal').close();
  app.editingTxId = null;
}

// ============================================================
// SAVE TRANSACTION (form submit)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('transactionForm').addEventListener('submit', async e => {
    e.preventDefault();
    const type = document.getElementById('txType').value;
    const isTransfer = type === 'Transfer';

    if (isTransfer) {
      await saveTransfer();
      return;
    }

    const tx = normalizeTx({
      id:          app.editingTxId || generateId(),
      date:        document.getElementById('txDate').value,
      wallet:      document.getElementById('txWallet').value,
      type,
      category:    document.getElementById('txCategory').value,
      description: document.getElementById('txDescription').value,
      amount:      parseFloat(document.getElementById('txAmount').value) || 0
    });

    if (app.editingTxId) {
      // Update
      const idx = app.transactions.findIndex(t => t.id === app.editingTxId);
      if (idx !== -1) app.transactions[idx] = tx;
      await pushUpdateToSheets(tx);
      showToast('Transaction updated!', 'success');
    } else {
      // Add
      app.transactions.unshift(tx);
      await pushAddToSheets(tx);
      showToast('Transaction added!', 'success');
    }

    saveCache();
    closeTransactionModal();
    renderCurrentPage();
  });
});

async function saveTransfer() {
  const from   = document.getElementById('txFromWallet').value;
  const to     = document.getElementById('txToWallet').value;
  const amount = parseFloat(document.getElementById('txAmount').value) || 0;
  const date   = document.getElementById('txDate').value;
  const desc   = document.getElementById('txDescription').value || `Transfer from ${from} to ${to}`;

  if (from === to) { showToast('Please select different wallets.', 'error'); return; }

  const txOut = normalizeTx({ id: generateId(), date, wallet: from, type: 'Transfer', category: 'Transfer', description: desc, amount: -amount });
  const txIn  = normalizeTx({ id: generateId(), date, wallet: to,   type: 'Transfer', category: 'Transfer', description: desc, amount: amount });

  app.transactions.unshift(txOut, txIn);
  await pushAddToSheets(txOut);
  await pushAddToSheets(txIn);

  saveCache();
  closeTransactionModal();
  showToast('Transfer saved!', 'success');
  renderCurrentPage();
}

// ============================================================
// DELETE TRANSACTION
// ============================================================
function openDeleteModal(id) {
  app.deletingTxId = id;
  document.getElementById('deleteModal').showModal();
}

async function confirmDelete() {
  const id = app.deletingTxId;
  if (!id) return;

  // Delete from Google Sheet first
  await pushDeleteToSheets(id);

  // Then remove locally
  app.transactions = app.transactions.filter(t => t.id !== id);
  saveCache();
  document.getElementById('deleteModal').close();
  app.deletingTxId = null;
  showToast('Transaction deleted.', 'success');
  renderCurrentPage();

}

// ============================================================
// TRANSACTION DETAIL MODAL
// ============================================================
function openDetailModal(id) {
  const tx = app.transactions.find(t => t.id === id);
  if (!tx) return;
  const sign = tx.type === 'Income' ? '+' : (tx.type === 'Transfer' ? '±' : '-');
  const amtClass = tx.type === 'Income' ? 'positive' : (tx.type === 'Expense' ? 'negative' : '');
  document.getElementById('detailContent').innerHTML = `
    <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value ${amtClass}">${sign}${fmt(Math.abs(tx.amount))}</span></div>
    <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${tx.type}</span></div>
    <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${fmtDate(tx.date)}</span></div>
    <div class="detail-row"><span class="detail-label">Wallet</span><span class="detail-value">${esc(tx.wallet)}</span></div>
    <div class="detail-row"><span class="detail-label">Category</span><span class="detail-value">${esc(tx.category)}</span></div>
    <div class="detail-row"><span class="detail-label">Description</span><span class="detail-value">${esc(tx.description || '—')}</span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${tx.createdTime ? new Date(tx.createdTime).toLocaleString() : '—'}</span></div>
  `;
  document.getElementById('detailEditBtn').onclick   = () => { document.getElementById('detailModal').close(); openEditModal(id); };
  document.getElementById('detailDeleteBtn').onclick = () => { document.getElementById('detailModal').close(); openDeleteModal(id); };
  document.getElementById('detailModal').showModal();
}

// ============================================================
// TRANSFER MODAL (Wallets page)
// ============================================================
function openTransferModal() {
  populateModalDropdowns();
  document.getElementById('transferDate').value = todayStr();
  document.getElementById('transferModal').showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('transferForm').addEventListener('submit', async e => {
    e.preventDefault();
    const from   = document.getElementById('transferFrom').value;
    const to     = document.getElementById('transferTo').value;
    const amount = parseFloat(document.getElementById('transferAmount').value) || 0;
    const date   = document.getElementById('transferDate').value;
    const desc   = document.getElementById('transferDescription').value || `Transfer from ${from} to ${to}`;

    if (from === to) { showToast('Please select different wallets.', 'error'); return; }

    const txOut = normalizeTx({ id: generateId(), date, wallet: from, type: 'Transfer', category: 'Transfer', description: desc, amount: -amount });
    const txIn  = normalizeTx({ id: generateId(), date, wallet: to,   type: 'Transfer', category: 'Transfer', description: desc, amount: amount });

    app.transactions.unshift(txOut, txIn);
    await pushAddToSheets(txOut);
    await pushAddToSheets(txIn);

    saveCache();
    document.getElementById('transferModal').close();
    showToast('Transfer saved!', 'success');
    renderCurrentPage();
  });
});

// ============================================================
// REPORTS PAGE
// ============================================================
function renderReports() {
  const monthSel = document.getElementById('reportMonth');
  const yearSel  = document.getElementById('reportYear');

  // Populate dropdowns if empty
  if (!monthSel.options.length) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    months.forEach((m, i) => monthSel.add(new Option(m, i)));
    monthSel.value = new Date().getMonth();

    const thisYear = new Date().getFullYear();
    for (let y = thisYear - 3; y <= thisYear; y++) yearSel.add(new Option(y, y));
    yearSel.value = thisYear;

    monthSel.addEventListener('change', renderReports);
    yearSel.addEventListener('change', renderReports);
  }

  const month = parseInt(monthSel.value);
  const year  = parseInt(yearSel.value);
  const ms    = getMonthlyStats(year, month);

  // Previous month comparison
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear  = month === 0 ? year - 1 : year;
  const prev      = getMonthlyStats(prevYear, prevMonth);
  const expChange = prev.expenses === 0 ? null : ((ms.expenses - prev.expenses) / prev.expenses * 100).toFixed(1);

  // Biggest spending category
  const catTotals = {};
  for (const tx of ms.transactions) {
    if (tx.type === 'Expense') catTotals[tx.category] = (catTotals[tx.category] || 0) + tx.amount;
  }
  const biggestCat     = Object.entries(catTotals).sort((a,b) => b[1]-a[1])[0];
  const highestExpense = ms.transactions.filter(t => t.type === 'Expense').sort((a,b) => b.amount - a.amount)[0];

  document.getElementById('reportSummary').innerHTML = `
    <div class="report-stat-card"><div class="report-stat-label">Total Income</div><div class="report-stat-value positive">${fmt(ms.income)}</div></div>
    <div class="report-stat-card"><div class="report-stat-label">Total Expenses</div><div class="report-stat-value negative">${fmt(ms.expenses)}</div></div>
    <div class="report-stat-card"><div class="report-stat-label">Savings</div><div class="report-stat-value ${ms.savings >= 0 ? 'positive' : 'negative'}">${fmt(ms.savings)}</div></div>
    <div class="report-stat-card"><div class="report-stat-label">Biggest Category</div><div class="report-stat-value">${biggestCat ? biggestCat[0] : '—'}</div><div class="report-stat-sub">${biggestCat ? fmt(biggestCat[1]) : ''}</div></div>
    <div class="report-stat-card"><div class="report-stat-label">Highest Expense</div><div class="report-stat-value">${highestExpense ? fmt(highestExpense.amount) : '—'}</div><div class="report-stat-sub">${highestExpense ? esc(highestExpense.description || highestExpense.category) : ''}</div></div>
    <div class="report-stat-card"><div class="report-stat-label">vs. Previous Month</div><div class="report-stat-value ${expChange !== null && expChange > 0 ? 'negative' : 'positive'}">${expChange !== null ? (expChange > 0 ? '+' : '') + expChange + '%' : '—'}</div><div class="report-stat-sub">Expenses change</div></div>
  `;

  renderCharts(year, month);
}

function renderCharts(year, month) {
  const isDark = document.body.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  Chart.defaults.color = textColor;

  // ---- Balance Line Chart (last 12 months) ----
  const months12 = [];
  let runningBalance = 0;
  const balancePoints = [];

  // Calculate running balance month by month going back 12 months
  const allSorted = [...app.transactions].sort((a,b) => new Date(a.date) - new Date(b.date));
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    months12.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));
  }

  // Get cumulative balance at end of each month
  const monthBalances = months12.map((_, idx) => {
    const targetDate = new Date(year, month - (11 - idx) + 1, 0); // last day of that month
    const balanceAtPoint = allSorted.reduce((sum, tx) => {
      if (new Date(tx.date) <= targetDate) {
        if (tx.type === 'Income')  sum += tx.amount;
        if (tx.type === 'Expense') sum -= tx.amount;
      }
      return sum;
    }, 0);
    return Math.round(balanceAtPoint * 100) / 100;
  });

  const ctxBalance = document.getElementById('balanceChart');
  if (app.charts.balance) app.charts.balance.destroy();
  app.charts.balance = new Chart(ctxBalance, {
    type: 'line',
    data: {
      labels: months12,
      datasets: [{
        label: 'Balance',
        data: monthBalances,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: v => '$' + v.toLocaleString() } }
      }
    }
  });

  // ---- Income vs Expenses Bar Chart (last 12 months) ----
  const incomeData = [], expenseData = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    const stats = getMonthlyStats(d.getFullYear(), d.getMonth());
    incomeData.push(stats.income);
    expenseData.push(stats.expenses);
  }

  const ctxIE = document.getElementById('incomeExpenseChart');
  if (app.charts.incomeExpense) app.charts.incomeExpense.destroy();
  app.charts.incomeExpense = new Chart(ctxIE, {
    type: 'bar',
    data: {
      labels: months12,
      datasets: [
        { label: 'Income',   data: incomeData,   backgroundColor: 'rgba(22,163,74,0.7)'  },
        { label: 'Expenses', data: expenseData,  backgroundColor: 'rgba(220,38,38,0.7)'  }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { grid: { color: gridColor } },
        y: { grid: { color: gridColor }, ticks: { callback: v => '$' + v.toLocaleString() } }
      }
    }
  });

  // ---- Category Doughnut Chart ----
  const catMap = {};
  for (const tx of app.transactions) {
    if (tx.type === 'Expense') {
      const d = new Date(tx.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        catMap[tx.category] = (catMap[tx.category] || 0) + tx.amount;
      }
    }
  }
  const catLabels = Object.keys(catMap);
  const catValues = Object.values(catMap);
  const palette   = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

  const ctxCat = document.getElementById('categoryChart');
  if (app.charts.category) app.charts.category.destroy();
  app.charts.category = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{
        data: catValues,
        backgroundColor: palette.slice(0, catLabels.length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// ============================================================
// SETTINGS PAGE
// ============================================================
function renderSettings() {
  // Script URL
  document.getElementById('scriptUrlInput').value = app.settings.scriptUrl;

  // Wallets list
  const wList = document.getElementById('walletSettingsList');
  wList.innerHTML = '<div class="tag-list">' +
    app.settings.wallets.map(w => `
      <div class="tag">
        ${esc(w)}
        <button class="tag-remove" data-wallet="${esc(w)}" title="Remove wallet">&times;</button>
      </div>`).join('') +
    '</div>';
  wList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (app.settings.wallets.length <= 1) { showToast('You need at least one wallet.', 'error'); return; }
      app.settings.wallets = app.settings.wallets.filter(w => w !== btn.dataset.wallet);
      saveSettings(); renderSettings();
    });
  });

  // Categories list
  const cList = document.getElementById('categorySettingsList');
  cList.innerHTML = '<div class="tag-list">' +
    app.settings.categories.map(c => `
      <div class="tag">
        ${esc(c)}
        <button class="tag-remove" data-cat="${esc(c)}" title="Remove category">&times;</button>
      </div>`).join('') +
    '</div>';
  cList.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      app.settings.categories = app.settings.categories.filter(c => c !== btn.dataset.cat);
      saveSettings(); renderSettings();
    });
  });

  // Recurring
  const recurring = load('finance_recurring', []);
  const recList   = document.getElementById('recurringList');
  if (recurring.length === 0) {
    recList.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No recurring transactions yet.</p>';
  } else {
    recList.innerHTML = recurring.map((r, i) => `
      <div class="recurring-item">
        <div class="recurring-info">
          <div class="recurring-name">${esc(r.name)}</div>
          <div class="recurring-meta">${r.type} &middot; ${r.wallet} &middot; ${fmt(r.amount)} &middot; ${r.frequency}</div>
        </div>
        <button class="icon-btn del-rec" data-idx="${i}" title="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>`).join('');
    recList.querySelectorAll('.del-rec').forEach(btn => {
      btn.addEventListener('click', () => {
        recurring.splice(+btn.dataset.idx, 1);
        save('finance_recurring', recurring);
        renderSettings();
      });
    });
  }
}

// ============================================================
// RECURRING MODAL
// ============================================================
function openRecurringModal() {
  populateModalDropdowns();
  document.getElementById('recurringModal').showModal();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('recurringForm').addEventListener('submit', e => {
    e.preventDefault();
    const recurring = load('finance_recurring', []);
    recurring.push({
      name:      document.getElementById('recName').value,
      type:      document.getElementById('recType').value,
      frequency: document.getElementById('recFrequency').value,
      wallet:    document.getElementById('recWallet').value,
      category:  document.getElementById('recCategory').value,
      amount:    parseFloat(document.getElementById('recAmount').value) || 0,
      lastRun:   null
    });
    save('finance_recurring', recurring);
    document.getElementById('recurringModal').close();
    document.getElementById('recurringForm').reset();
    showToast('Recurring transaction saved!', 'success');
    renderSettings();
  });
});

function checkRecurring() {
  const recurring = load('finance_recurring', []);
  const today     = new Date(); today.setHours(0,0,0,0);
  let added       = false;

  for (const r of recurring) {
    const last = r.lastRun ? new Date(r.lastRun) : null;
    let isDue  = false;
    if (!last) {
      isDue = true;
    } else {
      if (r.frequency === 'daily' && (today - last) >= 86400000) isDue = true;
      if (r.frequency === 'weekly' && (today - last) >= 7 * 86400000) isDue = true;
      if (r.frequency === 'monthly') {
        isDue = today.getMonth() !== last.getMonth() || today.getFullYear() !== last.getFullYear();
      }
    }
    if (isDue) {
      const tx = normalizeTx({ date: todayStr(), wallet: r.wallet, type: r.type, category: r.category, description: r.name, amount: r.amount });
      app.transactions.unshift(tx);
      pushAddToSheets(tx);
      r.lastRun = today.toISOString();
      added = true;
    }
  }

  if (added) {
    save('finance_recurring', recurring);
    saveCache();
    showToast('Recurring transactions added!', 'success');
  }
}

// ============================================================
// CSV EXPORT / IMPORT
// ============================================================
function exportCSV() {
  const headers = ['ID','Date','Wallet','Type','Category','Description','Amount','Created Time'];
  const rows    = app.transactions.map(tx => [
    tx.id, tx.date, tx.wallet, tx.type, tx.category,
    '"' + (tx.description || '').replace(/"/g, '""') + '"',
    tx.amount, tx.createdTime
  ].join(','));
  const csv     = [headers.join(','), ...rows].join('\n');
  const blob    = new Blob([csv], { type: 'text/csv' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href = url; a.download = 'transactions.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported!', 'success');
}

function importCSV(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    const lines   = e.target.result.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(' ', ''));
    let count     = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const tx = normalizeTx({
        id:          cols[0]?.trim() || generateId(),
        date:        cols[1]?.trim(),
        wallet:      cols[2]?.trim(),
        type:        cols[3]?.trim(),
        category:    cols[4]?.trim(),
        description: (cols[5] || '').trim().replace(/^"|"$/g, ''),
        amount:      parseFloat(cols[6]) || 0,
        createdTime: cols[7]?.trim()
      });
      if (!app.transactions.find(t => t.id === tx.id)) {
        app.transactions.push(tx);
        await pushAddToSheets(tx);
        count++;
      }
    }
    saveCache();
    renderCurrentPage();
    showToast(`Imported ${count} transactions!`, 'success');
  };
  reader.readAsText(file);
}

// ============================================================
// THEME TOGGLE
// ============================================================
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  save('finance_theme', isDark ? 'dark' : 'light');
  document.querySelector('.theme-btn-text').textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

function loadTheme() {
  const saved = load('finance_theme', 'light');
  if (saved === 'dark') {
    document.body.classList.add('dark');
    document.querySelector('.theme-btn-text').textContent = 'Light Mode';
  }
}

// ============================================================
// SETUP BANNER
// ============================================================
function showBanner() {
  const banner = document.getElementById('setupBanner');
  if (banner) banner.style.display = app.settings.scriptUrl ? 'none' : 'flex';
}

// ============================================================
// SIDEBAR (mobile)
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function fmt(amount) {
  return formatCurrency(amount);
}
function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = 'toast show ' + type;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// EVENT LISTENERS
// ============================================================
function setupEvents() {
  // Navigation links (sidebar + bottom nav)
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
  });

  // Sidebar toggle (mobile)
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Sync button
  document.getElementById('syncBtn').addEventListener('click', syncFromSheets);

  // Add transaction buttons (page button + floating button)
  document.getElementById('addTxBtn').addEventListener('click', openAddModal);
  document.getElementById('fabBtn').addEventListener('click', openAddModal);

  // Close transaction modal
  document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
  document.getElementById('cancelTxBtn').addEventListener('click', closeTransactionModal);

  // Transfer type toggle in transaction form
  document.getElementById('txType').addEventListener('change', e => toggleTransferFields(e.target.value));

  // Delete modal
  document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    document.getElementById('deleteModal').close();
    app.deletingTxId = null;
  });
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

  // Detail modal
  document.getElementById('closeDetailModal').addEventListener('click', () => {
    document.getElementById('detailModal').close();
  });

  // Wallets page transfer button
  document.getElementById('openTransferBtn').addEventListener('click', openTransferModal);
  document.getElementById('closeTransferModal').addEventListener('click', () => document.getElementById('transferModal').close());
  document.getElementById('cancelTransferBtn').addEventListener('click', () => document.getElementById('transferModal').close());

  // Filters on transactions page
  document.getElementById('searchInput').addEventListener('input', e => {
    app.filters.search = e.target.value; app.txPage = 1; renderTransactions();
  });
  document.getElementById('filterType').addEventListener('change', e => {
    app.filters.type = e.target.value; app.txPage = 1; renderTransactions();
  });
  document.getElementById('filterWallet').addEventListener('change', e => {
    app.filters.wallet = e.target.value; app.txPage = 1; renderTransactions();
  });
  document.getElementById('filterCategory').addEventListener('change', e => {
    app.filters.category = e.target.value; app.txPage = 1; renderTransactions();
  });
  document.getElementById('sortBy').addEventListener('change', e => {
    app.filters.sortBy = e.target.value; renderTransactions();
  });

  // Date filter pills
  document.querySelectorAll('.date-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      app.filters.quickFilter = btn.dataset.filter;
      app.txPage = 1;
      const customRow = document.getElementById('customDateRow');
      customRow.style.display = btn.dataset.filter === 'custom' ? 'flex' : 'none';
      if (btn.dataset.filter !== 'custom') renderTransactions();
    });
  });
  document.getElementById('applyDateBtn').addEventListener('click', () => {
    app.filters.dateFrom = document.getElementById('dateFrom').value;
    app.filters.dateTo   = document.getElementById('dateTo').value;
    app.txPage = 1;
    renderTransactions();
  });

  document.getElementById('currencySelect').addEventListener('change', e => {
    setCurrency(e.target.value);
  });

  // Settings: save script URL
  document.getElementById('saveScriptUrlBtn').addEventListener('click', () => {
    app.settings.scriptUrl = document.getElementById('scriptUrlInput').value.trim();
    saveSettings();
    showToast('URL saved!', 'success');
    showBanner();
  });

  // Settings: test connection
  document.getElementById('testConnectionBtn').addEventListener('click', async () => {
    const url    = document.getElementById('scriptUrlInput').value.trim();
    const status = document.getElementById('connectionStatus');
    if (!url) { status.textContent = 'Please enter a URL first.'; status.className = 'connection-status error'; return; }
    status.textContent = 'Testing…'; status.className = 'connection-status';
    try {
      const res  = await fetch(url + '?action=getAll');
      const data = await res.json();
      if (data.transactions !== undefined) {
        status.textContent = 'Connected! Found ' + data.transactions.length + ' transactions.';
        status.className   = 'connection-status ok';
      } else {
        status.textContent = 'Connected but unexpected response.';
        status.className   = 'connection-status error';
      }
    } catch {
      status.textContent = 'Connection failed. Check the URL and make sure the script is deployed as a Web App.';
      status.className   = 'connection-status error';
    }
  });

  // Settings: add wallet
  document.getElementById('addWalletBtn').addEventListener('click', () => {
    const name = document.getElementById('newWalletInput').value.trim();
    if (!name) return;
    if (app.settings.wallets.includes(name)) { showToast('Wallet already exists.', 'error'); return; }
    app.settings.wallets.push(name);
    saveSettings();
    document.getElementById('newWalletInput').value = '';
    renderSettings();
  });

  // Settings: add category
  document.getElementById('addCategoryBtn').addEventListener('click', () => {
    const name = document.getElementById('newCategoryInput').value.trim();
    if (!name) return;
    if (app.settings.categories.includes(name)) { showToast('Category already exists.', 'error'); return; }
    app.settings.categories.push(name);
    saveSettings();
    document.getElementById('newCategoryInput').value = '';
    renderSettings();
  });

  // Settings: CSV export
  document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);

  // Settings: CSV import
  document.getElementById('importCsvInput').addEventListener('change', e => {
    if (e.target.files[0]) importCSV(e.target.files[0]);
  });

  // Settings: recurring
  document.getElementById('addRecurringBtn').addEventListener('click', openRecurringModal);
  document.getElementById('closeRecurringModal').addEventListener('click', () => document.getElementById('recurringModal').close());
  document.getElementById('cancelRecurringBtn').addEventListener('click', () => document.getElementById('recurringModal').close());

  // Banner "Go to Settings" link
  document.getElementById('setupBanner')?.querySelector('.nav-link-inline')?.addEventListener('click', e => {
    e.preventDefault(); showPage('settings');
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  });
}

// ============================================================
// INIT
// ============================================================
function init() {
  loadSettings();
  loadTheme();
  loadCache();
  loadLastSync();
  setupEvents();
  const currencySelect = document.getElementById('currencySelect');
  if (currencySelect) currencySelect.value = app.settings.currency || currentCurrency || 'IDR';
  renderDashboard();
  showBanner();
  checkRecurring();

  // Fetch fresh data in background
  if (app.settings.scriptUrl) {
    setTimeout(syncFromSheets, 500);
    setTimeout(syncSettingsFromSheets, 800);
  }
}

document.addEventListener('DOMContentLoaded', init);


// ======================
// CURRENCY SYSTEM
// ======================

const currencies = {

    IDR: {
        symbol: "Rp",
        locale: "id-ID"
    },

    USD: {
        symbol: "$",
        locale: "en-US"
    },

    EUR: {
        symbol: "€",
        locale: "de-DE"
    }

};


let currentCurrency = localStorage.getItem("currency") || "IDR";

function getActiveCurrency() {
  return (app.settings?.currency || currentCurrency || 'IDR').toUpperCase();
}

function setCurrency(currencyCode) {
  const code = (currencyCode || 'IDR').toUpperCase();
  if (!currencies[code]) return;
  currentCurrency = code;
  app.settings.currency = code;
  saveSettings();
  const currencySelect = document.getElementById('currencySelect');
  if (currencySelect) currencySelect.value = code;
  renderCurrentPage();
}

function formatCurrency(amount){
    const currencyCode = getActiveCurrency();
    const currency = currencies[currencyCode] || currencies.IDR;

    return new Intl.NumberFormat(
        currency.locale,
        {
            style: "currency",
            currency: currencyCode,
            maximumFractionDigits: currencyCode === "IDR" ? 0 : 2
        }
    ).format(amount);

}