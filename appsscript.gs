// Google Apps Script for the finance web app
// 1) Create a new Apps Script project
// 2) Paste this code into the editor
// 3) Deploy as a web app with "Execute as me" and "Anyone" access
// 4) Copy the web app URL into the app Settings page

function doGet(e) {
  const action = (e.parameter && e.parameter.action) ? e.parameter.action.toString() : 'getAll';

  if (action === 'getSettings') {
    const settings = getAllSettings();
    return jsonResponse({
      wallets: settings.wallets,
      categories: settings.categories
    });
  }

  const transactions = getAllTransactions();
  return jsonResponse({ transactions });
}

function doPost(e) {
  let data = {};

  try {
    const raw = e.postData && e.postData.getDataAsString ? e.postData.getDataAsString() : '';

    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (parseError) {
        data = parseFormBody(raw);
      }
    } else if (e.parameter) {
      data = e.parameter;
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Invalid request body' });
  }

  const action = (data.action || e.parameter && e.parameter.action || '').toString();

  switch (action) {
    case 'add':
      return handleAddTransaction(data);
    case 'update':
      return handleUpdateTransaction(data);
    case 'delete':
      return handleDeleteTransaction(data);
    case 'addSetting':
      return handleAddSetting(data);
    case 'deleteSetting':
      return handleDeleteSetting(data);
    default:
      return jsonResponse({ ok: false, error: 'Unknown action' });
  }
}

function handleAddTransaction(data) {
  const sheet = getOrCreateSheet('Transactions', ['id', 'date', 'wallet', 'type', 'category', 'description', 'amount', 'currency', 'createdTime']);
  const id = data.id || Utilities.getUuid();
  const row = [
    id,
    data.date || todayStr(),
    data.wallet || '',
    data.type || 'Expense',
    data.category || 'Other',
    data.description || '',
    String(data.amount || 0),
    data.currency || 'IDR',
    data.createdTime || new Date().toISOString()
  ];
  sheet.appendRow(row);
  return jsonResponse({ ok: true, id });
}

function handleUpdateTransaction(data) {
  const sheet = getOrCreateSheet('Transactions', ['id', 'date', 'wallet', 'type', 'category', 'description', 'amount', 'currency', 'createdTime']);
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) {
    return jsonResponse({ ok: false, error: 'No transactions found' });
  }

  const header = rows[0];
  const idIndex = header.indexOf('id');
  if (idIndex === -1) {
    return jsonResponse({ ok: false, error: 'Missing id column' });
  }

  const targetId = String(data.id || '');
  if (!targetId) {
    return jsonResponse({ ok: false, error: 'Missing id' });
  }

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === targetId) {
      const row = i + 1;
      sheet.getRange(row, 1, 1, 9).setValues([[
        data.id || rows[i][idIndex],
        data.date || rows[i][1] || todayStr(),
        data.wallet || rows[i][2] || '',
        data.type || rows[i][3] || 'Expense',
        data.category || rows[i][4] || 'Other',
        data.description || rows[i][5] || '',
        String(data.amount ?? rows[i][6] ?? 0),
        data.currency || rows[i][7] || 'IDR',
        data.createdTime || rows[i][8] || new Date().toISOString()
      ]]);
      return jsonResponse({ ok: true, id: targetId });
    }
  }

  return jsonResponse({ ok: false, error: 'Transaction not found' });
}

function handleDeleteTransaction(data) {
  const sheet = getOrCreateSheet('Transactions', ['id', 'date', 'wallet', 'type', 'category', 'description', 'amount', 'currency', 'createdTime']);
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) {
    return jsonResponse({ ok: false, error: 'No transactions found' });
  }

  const header = rows[0];
  const idIndex = header.indexOf('id');
  if (idIndex === -1) {
    return jsonResponse({ ok: false, error: 'Missing id column' });
  }

  const targetId = String(data.id || '');
  if (!targetId) {
    return jsonResponse({ ok: false, error: 'Missing id' });
  }

  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][idIndex] === targetId) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true, id: targetId });
    }
  }

  return jsonResponse({ ok: false, error: 'Transaction not found' });
}

function handleAddSetting(data) {
  const sheet = getOrCreateSheet('Settings', ['type', 'name']);
  const type = String(data.type || '').trim();
  const name = String(data.name || '').trim();

  if (!type || !name) {
    return jsonResponse({ ok: false, error: 'Missing type or name' });
  }

  const rows = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toLowerCase() === type.toLowerCase() && rows[i][1] && rows[i][1].toLowerCase() === name.toLowerCase()) {
      return jsonResponse({ ok: true, exists: true });
    }
  }

  sheet.appendRow([type, name]);
  return jsonResponse({ ok: true });
}

function handleDeleteSetting(data) {
  const sheet = getOrCreateSheet('Settings', ['type', 'name']);
  const type = String(data.type || '').trim();
  const name = String(data.name || '').trim();

  if (!type || !name) {
    return jsonResponse({ ok: false, error: 'Missing type or name' });
  }

  const rows = sheet.getDataRange().getDisplayValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] && rows[i][0].toLowerCase() === type.toLowerCase() && rows[i][1] && rows[i][1].toLowerCase() === name.toLowerCase()) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: true, removed: false });
}

function getAllTransactions() {
  const sheet = getOrCreateSheet('Transactions', ['id', 'date', 'wallet', 'type', 'category', 'description', 'amount', 'currency', 'createdTime']);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) {
    return [];
  }

  const header = values[0];
  const transactions = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row.join('').trim()) continue;

    transactions.push({
      id: row[header.indexOf('id')] || '',
      date: row[header.indexOf('date')] || '',
      wallet: row[header.indexOf('wallet')] || '',
      type: row[header.indexOf('type')] || 'Expense',
      category: row[header.indexOf('category')] || 'Other',
      description: row[header.indexOf('description')] || '',
      amount: parseFloat(row[header.indexOf('amount')]) || 0,
      currency: row[header.indexOf('currency')] || 'IDR',
      createdTime: row[header.indexOf('createdTime')] || ''
    });
  }

  return transactions;
}

function getAllSettings() {
  const sheet = getOrCreateSheet('Settings', ['type', 'name']);
  const values = sheet.getDataRange().getDisplayValues();
  const wallets = [];
  const categories = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[1]) continue;

    const type = String(row[0] || '').trim().toLowerCase();
    const name = String(row[1] || '').trim();
    if (!name) continue;

    if (type === 'wallet') {
      wallets.push(name);
    } else if (type === 'category') {
      categories.push(name);
    }
  }

  return { wallets, categories };
}

function getOrCreateSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function parseFormBody(raw) {
  const result = {};
  const pairs = raw.split('&');

  for (const pair of pairs) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    const key = separator === -1 ? decodeURIComponent(pair) : decodeURIComponent(pair.slice(0, separator));
    const value = separator === -1 ? '' : decodeURIComponent(pair.slice(separator + 1));
    result[key] = value;
  }

  return result;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
