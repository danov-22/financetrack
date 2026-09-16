const demo = location.pathname === "/demo" || new URLSearchParams(location.search).get("mode") === "demo" || sessionStorage.getItem("bewlet_demo_mode") === "1";
const OFFLINE_ACCOUNT_KEY = "bewlet_offline_approved_account";
if (demo) { window.BEWLET_DEMO = true; sessionStorage.setItem("bewlet_demo_mode", "1"); }

function readOfflineAccount() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFLINE_ACCOUNT_KEY) || "null");
    return saved?.account?.profile?.status === "approved" ? saved : null;
  } catch { return null; }
}

function cacheApprovedAccount(account, config) {
  if (account?.profile?.status !== "approved") return;
  try { localStorage.setItem(OFFLINE_ACCOUNT_KEY, JSON.stringify({ account, config, savedAt: Date.now() })); } catch {}
}

async function refreshSession(config) {
  const refreshToken = localStorage.getItem("bewlet_supabase_refresh_token");
  if (!refreshToken || !config?.supabaseUrl || !navigator.onLine) return null;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (!response.ok) return null;
    const session = await response.json();
    localStorage.setItem("bewlet_supabase_access_token", session.access_token);
    if (session.refresh_token) localStorage.setItem("bewlet_supabase_refresh_token", session.refresh_token);
    return session.access_token;
  } catch { return null; }
}

function installAuth(accessToken, account, config) {
  window.BEWLET_AUTH = { accessToken, account, config, offline: !navigator.onLine };
  window.bewletAuthFetch = async (url, options = {}) => {
    let token = window.BEWLET_AUTH.accessToken;
    let response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` } });
    if (response.status === 401 && navigator.onLine) {
      token = await refreshSession(config);
      if (!token) { location.replace("/?login=required"); return response; }
      window.BEWLET_AUTH.accessToken = token;
      response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` } });
    }
    if (!response.ok) response.clone().json().then((body) => console.error(`Bewlet API ${response.status} ${url}:`, body.error || body)).catch(() => {});
    return response;
  };
}

if (!demo) {
  const offlineAccount = readOfflineAccount();
  let config = await fetch("/api/public-config", { cache: "no-store" }).then((response) => response.json()).catch(() => offlineAccount?.config || {});
  let accessToken = localStorage.getItem("bewlet_supabase_access_token");
  if ((!accessToken || !config.supabaseUrl) && navigator.onLine) accessToken = await refreshSession(config);

  let accountResponse = null;
  if (accessToken && navigator.onLine) accountResponse = await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
  if (accountResponse?.status === 401) {
    accessToken = await refreshSession(config);
    accountResponse = accessToken ? await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null) : null;
  }

  if (accountResponse?.ok) {
    let account = await accountResponse.json();
    if (account.profile?.status !== "approved") location.replace(`/?status=${encodeURIComponent(account.profile?.status || "pending")}`);
    else {
      const fullAccountResponse = await fetch("/api/account", { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
      if (fullAccountResponse?.ok) account = await fullAccountResponse.json();
      cacheApprovedAccount(account, config);
      installAuth(accessToken, account, config);
    }
  } else if (!accountResponse && offlineAccount && accessToken) {
    config = offlineAccount.config || config;
    installAuth(accessToken, offlineAccount.account, config);
  } else if (navigator.onLine) {
    location.replace("/?login=required");
  }
}

if (demo || window.BEWLET_AUTH) await import("./script.js");
