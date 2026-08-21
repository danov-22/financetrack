const { send, supabase, authenticatedUser, googleAccessFor, googleFetch } = require("./_lib");

const SHEET_SCHEMA = 1;
const TX_HEADERS = ["ID", "Date", "Wallet", "Type", "Category", "Description", "Amount", "Currency", "Created Time", "Status", "Recurring", "Recurring Frequency", "Last Recurring"];

async function ensureSpreadsheet(session, access) {
  if (session.profile.google_sheet_id) {
    try { await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(session.profile.google_sheet_id)}?fields=spreadsheetId`, access); return session.profile.google_sheet_id; } catch {}
  }
  const created = await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", access, { method: "POST", body: JSON.stringify({ properties: { title: "Bewlet Finance Data" }, sheets: [{ properties: { title: "Transactions", gridProperties: { frozenRowCount: 1 } } }, { properties: { title: "AppData", gridProperties: { frozenRowCount: 1 } } }, { properties: { title: "Metadata" } }] }) });
  await supabase("/rest/v1/profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: session.user.id, email: session.user.email || session.profile.email || "", display_name: session.profile.display_name || session.user.email || "Bewlet user", status: session.profile.status, license_type: session.profile.license_type || null, google_sheet_id: created.spreadsheetId, updated_at: new Date().toISOString() }) });
  return created.spreadsheetId;
}

function snapshotToRanges(snapshot, revision) {
  const transactions = [TX_HEADERS, ...(snapshot.transactions || []).map((tx) => [tx.id, tx.date, tx.wallet || "", tx.type, tx.category || "", tx.description || "", Number(tx.amount) || 0, tx.currency || snapshot.settings?.currency || "IDR", tx.createdTime || "", tx.status || "completed", Boolean(tx.recurring), tx.recurringFreq || "", tx.lastRecurring || ""])];
  const appData = [["Key", "JSON"], ...["wallets", "categories", "listItems", "budgets", "goals", "settings"].map((key) => [key, JSON.stringify(snapshot[key] ?? (key === "settings" ? {} : []))])];
  const metadata = [["Key", "Value"], ["schemaVersion", String(SHEET_SCHEMA)], ["revision", revision], ["updatedAt", new Date().toISOString()]];
  return [{ range: "Transactions!A1:M", values: transactions }, { range: "AppData!A1:B", values: appData }, { range: "Metadata!A1:B", values: metadata }];
}

async function readSnapshot(sheetId, access) {
  const ranges = ["Transactions!A:M", "AppData!A:B", "Metadata!A:B"].map(encodeURIComponent).map((range) => `ranges=${range}`).join("&");
  const data = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${ranges}`, access);
  const [txRange, appRange, metaRange] = data.valueRanges || [];
  const txRows = txRange?.values || [];
  const transactions = txRows.slice(1).filter((row) => row[0]).map((row) => ({ id: String(row[0]), date: String(row[1] || ""), wallet: String(row[2] || ""), type: row[3] === "income" ? "income" : "expense", category: String(row[4] || ""), description: String(row[5] || ""), amount: Number(row[6]) || 0, currency: String(row[7] || "IDR"), createdTime: String(row[8] || ""), status: row[9] === "planned" ? "planned" : "completed", recurring: row[10] === true || row[10] === "TRUE", recurringFreq: String(row[11] || ""), lastRecurring: String(row[12] || "") }));
  const app = {};
  (appRange?.values || []).slice(1).forEach(([key, json]) => { try { app[key] = JSON.parse(json || "null"); } catch {} });
  const metadata = Object.fromEntries((metaRange?.values || []).slice(1).map(([key, value]) => [key, value]));
  return { transactions, wallets: app.wallets || [], categories: app.categories || [], listItems: app.listItems || [], budgets: app.budgets || [], goals: app.goals || [], settings: app.settings || {}, revision: metadata.revision || "", updatedAt: metadata.updatedAt || null, schemaVersion: Number(metadata.schemaVersion) || SHEET_SCHEMA };
}

async function writeSnapshot(sheetId, access, snapshot, expectedRevision, force = false) {
  const current = await readSnapshot(sheetId, access);
  if (!force && expectedRevision && current.revision && expectedRevision !== current.revision) throw Object.assign(new Error("Newer changes exist in Google Sheets. Pull them before overwriting."), { status: 409, code: "sync_conflict", server: current });
  const revision = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchClear`, access, { method: "POST", body: JSON.stringify({ ranges: ["Transactions!A:M", "AppData!A:B", "Metadata!A:B"] }) });
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`, access, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: snapshotToRanges(snapshot, revision) }) });
  return revision;
}

async function createBackup(userId, access, snapshot, revision, force = false) {
  if (!force) {
    const latest = await supabase(`/rest/v1/data_backups?user_id=eq.${userId}&select=created_at&order=created_at.desc&limit=1`);
    if (latest?.[0] && Date.now() - new Date(latest[0].created_at).getTime() < 24 * 60 * 60 * 1000) return null;
  }
  const content = JSON.stringify({ format: "bewlet-backup", version: SHEET_SCHEMA, revision, createdAt: new Date().toISOString(), data: snapshot });
  const boundary = `bewlet_${Date.now()}`;
  const metadata = { name: `Bewlet Backup ${new Date().toISOString().slice(0, 10)}.json`, mimeType: "application/json", appProperties: { app: "bewlet", kind: "backup" } };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size", { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  const file = await response.json();
  if (!response.ok) throw new Error(file?.error?.message || "Could not create backup");
  await supabase("/rest/v1/data_backups", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, drive_file_id: file.id, spreadsheet_revision: revision || null, byte_size: Buffer.byteLength(content) }) });
  const older = await supabase(`/rest/v1/data_backups?user_id=eq.${userId}&select=id,drive_file_id&order=created_at.desc&offset=30`);
  for (const backup of older || []) {
    await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(backup.drive_file_id)}`, access, { method: "DELETE" }).catch(() => {});
    await supabase(`/rest/v1/data_backups?id=eq.${backup.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  return file.id;
}

module.exports = async function handler(request, response) {
  try {
    const session = await authenticatedUser(request, true);
    const access = await googleAccessFor(session.user.id);
    const sheetId = await ensureSpreadsheet(session, access);
    if (request.method === "GET") {
      const snapshot = await readSnapshot(sheetId, access);
      return send(response, 200, { snapshot, sheetId });
    }
    if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" });
    const body = request.body || {};
    if (body.action === "push") {
      const before = await readSnapshot(sheetId, access);
      if (before.transactions.length || before.wallets.length) await createBackup(session.user.id, access, before, before.revision);
      const revision = await writeSnapshot(sheetId, access, body.snapshot || {}, body.expectedRevision || "", Boolean(body.force));
      return send(response, 200, { revision, sheetId });
    }
    if (body.action === "backup") {
      const snapshot = await readSnapshot(sheetId, access);
      const fileId = await createBackup(session.user.id, access, snapshot, snapshot.revision, true);
      return send(response, 200, { fileId });
    }
    if (body.action === "restore") {
      const rows = await supabase(`/rest/v1/data_backups?id=eq.${encodeURIComponent(body.backupId)}&user_id=eq.${session.user.id}&select=*`);
      if (!rows?.[0]) return send(response, 404, { error: "Backup not found" });
      const current = await readSnapshot(sheetId, access);
      await createBackup(session.user.id, access, current, current.revision, true);
      const backupResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(rows[0].drive_file_id)}?alt=media`, { headers: { Authorization: `Bearer ${access}` } });
      if (!backupResponse.ok) throw new Error("Could not read backup from Google Drive");
      const backup = await backupResponse.json();
      const revision = await writeSnapshot(sheetId, access, backup.data, current.revision, true);
      return send(response, 200, { revision, snapshot: backup.data });
    }
    return send(response, 400, { error: "Unknown action" });
  } catch (error) { return send(response, error.status || 500, { error: error.message, code: error.code, server: error.server }); }
};

module.exports._test = { snapshotToRanges };
