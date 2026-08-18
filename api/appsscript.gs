/**
 * Personal Finance Dashboard — Google Apps Script
 * ================================================
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Paste this entire file into your Apps Script project.
 * Then click "Deploy" → "New deployment" → "Web app".
 *
 * Sheet structure:
 *   Sheet 1: "Transactions"
 *     Columns: ID | Date | Wallet | Type | Category | Description | Amount | Currency | Created Time
 *
 *   Sheet 2: "Settings"
 *     Columns: Type | Name
 *     Examples: Wallet | Personal
 *               Category | Food
 *
 *   Sheet 3: "Feedback"
 *     Columns: ID | User ID | Type | Message | Page | Status | Created Time | Withdrawn Time | Attachment URL
 */

const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const TX_SHEET_NAME  = 'Transactions';
const SET_SHEET_NAME = 'Settings';
const FEEDBACK_SHEET_NAME = 'Feedback';

// ─────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────
function doGet(e) {
  const parameters = e && e.parameter ? e.parameter : {};
  const action = parameters.action || 'health';
  let result;

  try {
    if (action === 'health') {
      result = {
        success: true,
        message: 'Bewlet API is running. Use the deployed web-app URL from the browser.',
      };
    } else if (action === 'getAll') {
      result = getAllTransactions();
    } else if (action === 'getSettings') {
      result = getSettings();
    } else if (action === 'getFeedback') {
      result = getFeedback(parameters.userId);
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────
function doPost(e) {
  let body;
  let result;

  try {
    const raw = e.postData ? e.postData.contents : '{}';
    body = JSON.parse(raw);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: 'Invalid JSON: ' + err.message }))
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    const action = body.action;

    if (action === 'add') {
      result = addTransaction(body);
    } else if (action === 'update') {
      result = updateTransaction(body);
    } else if (action === 'delete') {
      result = deleteTransaction(body.id);
    } else if (action === 'addSetting') {
      result = addSetting(body.type, body.name);
    } else if (action === 'deleteSetting') {
      result = deleteSetting(body.type, body.name);
    } else if (action === 'saveFeedback') {
      result = saveFeedback(body);
    } else if (action === 'withdrawFeedback') {
      result = withdrawFeedback(body.id, body.userId);
    } else if (action === 'deleteFeedback') {
      result = deleteFeedback(body.id, body.userId);
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────
function getSheet(name) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet   = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === TX_SHEET_NAME) {
      sheet.appendRow(['ID','Date','Wallet','Type','Category','Description','Amount','Currency','Created Time']);
    } else if (name === SET_SHEET_NAME) {
      sheet.appendRow(['Type','Name']);
      // Default wallets and categories
      sheet.appendRow(['Wallet','Personal']);
      sheet.appendRow(['Wallet','Other']);
      sheet.appendRow(['Category','Food']);
      sheet.appendRow(['Category','Transport']);
      sheet.appendRow(['Category','Housing']);
      sheet.appendRow(['Category','Entertainment']);
      sheet.appendRow(['Category','Shopping']);
      sheet.appendRow(['Category','Health']);
      sheet.appendRow(['Category','Salary']);
      sheet.appendRow(['Category','Other']);
    } else if (name === FEEDBACK_SHEET_NAME) {
      sheet.appendRow(['ID','User ID','Type','Message','Page','Status','Created Time','Withdrawn Time','Attachment URL']);
    }
  }
  return sheet;
}

// ─────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────
function getFeedback(userId) {
  if (!userId) return { success: false, error: 'User ID is required.' };
  const data = getSheet(FEEDBACK_SHEET_NAME).getDataRange().getValues();
  const feedback = data.slice(1)
    .filter(row => String(row[1]) === String(userId))
    .map(row => ({
      id: String(row[0] || ''),
      userId: String(row[1] || ''),
      type: String(row[2] || 'Feedback'),
      message: String(row[3] || ''),
      page: String(row[4] || ''),
      status: String(row[5] || 'sent'),
      createdTime: String(row[6] || ''),
      withdrawnTime: String(row[7] || ''),
      attachmentUrl: String(row[8] || ''),
    }));
  return { success: true, data: feedback };
}

function saveFeedback(body) {
  if (!body.id || !body.userId || !body.message) {
    return { success: false, error: 'ID, user ID, and message are required.' };
  }
  const sheet = getSheet(FEEDBACK_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) return { success: true, data: { id: body.id } };
  }
  let attachmentUrl = '';
  if (body.attachmentData) {
    const match = String(body.attachmentData).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return { success: false, error: 'Invalid screenshot data.' };
    const folders = DriveApp.getFoldersByName('Bewlet Feedback Attachments');
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Bewlet Feedback Attachments');
    const safeName = String(body.attachmentName || ('feedback-' + body.id + '.jpg')).replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], safeName);
    attachmentUrl = folder.createFile(blob).getUrl();
  }
  if (sheet.getLastColumn() < 9) sheet.getRange(1, 9).setValue('Attachment URL');
  sheet.appendRow([
    body.id, body.userId, body.type || 'Feedback', body.message,
    body.page || '', 'sent', body.createdTime || new Date().toISOString(), '', attachmentUrl,
  ]);
  return { success: true, data: { id: body.id, attachmentUrl } };
}

function withdrawFeedback(id, userId) {
  const sheet = getSheet(FEEDBACK_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id) && String(data[i][1]) === String(userId)) {
      sheet.getRange(i + 1, 6, 1, 3).setValues([[
        'withdrawn', data[i][6], new Date().toISOString(),
      ]]);
      return { success: true, data: { id } };
    }
  }
  return { success: false, error: 'Feedback not found.' };
}

function deleteFeedback(id, userId) {
  const sheet = getSheet(FEEDBACK_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(id) && String(data[i][1]) === String(userId)) {
      const attachmentUrl = String(data[i][8] || '');
      const fileIdMatch = attachmentUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        try { DriveApp.getFileById(fileIdMatch[1]).setTrashed(true); } catch (err) {}
      }
      sheet.deleteRow(i + 1);
      return { success: true, data: { id } };
    }
  }
  return { success: false, error: 'Feedback not found.' };
}

function rowToTransaction(row) {
  const rawDate = row[1];
  const normalizedDate = Object.prototype.toString.call(rawDate) === '[object Date]' && !isNaN(rawDate)
    ? Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : String(rawDate || '');
  return {
    id:          String(row[0] || ''),
    date:        normalizedDate,
    wallet:      String(row[2] || ''),
    type:        String(row[3] || ''),
    category:    String(row[4] || ''),
    description: String(row[5] || ''),
    amount:      parseFloat(row[6]) || 0,
    currency:    String(row[7] || 'IDR'),
    createdTime: String(row[8] || ''),
  };
}

function getAllTransactions() {
  const sheet = getSheet(TX_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };

  const rows = data.slice(1)
    .filter(r => r[0] && String(r[0]).trim())
    .map(rowToTransaction);

  return { success: true, data: rows };
}

function addTransaction(body) {
  const sheet = getSheet(TX_SHEET_NAME);
  const id    = body.id || generateIdGAS();
  const now   = body.createdTime || new Date().toISOString();

  sheet.appendRow([
    id,
    body.date        || '',
    body.wallet      || '',
    body.type        || 'expense',
    body.category    || '',
    body.description || '',
    parseFloat(body.amount) || 0,
    body.currency    || 'IDR',
    now,
  ]);

  return { success: true, data: { id } };
}

function updateTransaction(body) {
  const sheet = getSheet(TX_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.getRange(i + 1, 1, 1, 9).setValues([[
        body.id,
        body.date        || data[i][1],
        body.wallet      || data[i][2],
        body.type        || data[i][3],
        body.category    || data[i][4],
        body.description !== undefined ? body.description : data[i][5],
        parseFloat(body.amount) || data[i][6],
        body.currency    || data[i][7],
        data[i][8],
      ]]);
      return { success: true, data: { id: body.id } };
    }
  }

  // If not found, add it
  return addTransaction(body);
}

function deleteTransaction(id) {
  const sheet = getSheet(TX_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true, data: { id } };
    }
  }

  return { success: false, error: 'Transaction not found: ' + id };
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
function getSettings() {
  const sheet = getSheet(SET_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  const wallets    = [];
  const categories = [];

  for (let i = 1; i < data.length; i++) {
    const type = String(data[i][0] || '').trim();
    const name = String(data[i][1] || '').trim();
    if (!name) continue;
    if (type === 'Wallet')   wallets.push(name);
    if (type === 'Category') categories.push(name);
  }

  return { success: true, data: { wallets, categories } };
}

function addSetting(type, name) {
  if (!type || !name) return { success: false, error: 'Type and name are required.' };

  const sheet = getSheet(SET_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  // Check for duplicates
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(type) && String(data[i][1]) === String(name)) {
      return { success: true, data: { type, name }, note: 'already exists' };
    }
  }

  sheet.appendRow([type, name]);
  return { success: true, data: { type, name } };
}

function deleteSetting(type, name) {
  const sheet = getSheet(SET_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(type) && String(data[i][1]) === String(name)) {
      sheet.deleteRow(i + 1);
      return { success: true, data: { type, name } };
    }
  }

  return { success: false, error: 'Setting not found.' };
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────
function generateIdGAS() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
