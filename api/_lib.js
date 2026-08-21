const crypto = require("crypto");

function send(response, status, body) {
  response.setHeader("Cache-Control", "no-store");
  response.status(status).json(body);
}

function bearer(request) {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function supabase(path, options = {}, token = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY) {
  const response = await fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || `Supabase ${response.status}`);
  return data;
}

async function authenticatedUser(request, approved = false) {
  const token = bearer(request);
  if (!token) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) throw Object.assign(new Error("Session expired"), { status: 401 });
  const user = await userResponse.json();
  const profiles = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
  const ownerEmails = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const owner = ownerEmails.includes(String(user.email || "").trim().toLowerCase());
  let profile = profiles?.[0];
  if (!profile && owner) profile = { id: user.id, email: user.email, display_name: user.user_metadata?.full_name || user.email, status: "approved", license_type: "lifetime", google_sheet_id: null };
  if (!profile) throw Object.assign(new Error("Account profile not found"), { status: 403 });
  if (owner) profile = { ...profile, status: "approved", license_type: profile.license_type || "lifetime" };
  if (approved && profile.status !== "approved") throw Object.assign(new Error(`Account is ${profile.status}`), { status: 403, code: profile.status });
  return { token, user, profile };
}

function encryptionKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(secret).digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decrypt(value) {
  const [iv, tag, data] = String(value).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
function signedState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", encryptionKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
function verifyState(state) {
  const [encoded, signature] = String(state || "").split(".");
  const expected = crypto.createHmac("sha256", encryptionKey()).update(encoded).digest("base64url");
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) throw new Error("OAuth request expired");
  return payload;
}

async function googleAccessFor(userId) {
  const rows = await supabase(`/rest/v1/google_connections?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  if (!rows?.[0]) throw Object.assign(new Error("Connect Google Drive first"), { status: 409, code: "google_not_connected" });
  const refreshToken = decrypt(rows[0].encrypted_refresh_token);
  const body = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || "Google authorization expired");
  return data.access_token;
}

async function googleFetch(url, accessToken, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error?.message || `Google API ${response.status}`);
  return data;
}

function privateHandler(request, response) { return send(response, 404, { error: "Not found" }); }
module.exports = Object.assign(privateHandler, { send, supabase, authenticatedUser, encrypt, signedState, verifyState, googleAccessFor, googleFetch });
