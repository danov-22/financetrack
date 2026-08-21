const demo = new URLSearchParams(location.search).get("mode") === "demo" || sessionStorage.getItem("bewlet_demo_mode") === "1";
if (demo) { window.BEWLET_DEMO = true; sessionStorage.setItem("bewlet_demo_mode", "1"); }

async function refreshSession(config) {
  const refreshToken = localStorage.getItem("bewlet_supabase_refresh_token");
  if (!refreshToken) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!response.ok) return null;
  const session = await response.json();
  localStorage.setItem("bewlet_supabase_access_token", session.access_token);
  if (session.refresh_token) localStorage.setItem("bewlet_supabase_refresh_token", session.refresh_token);
  return session.access_token;
}

if (!demo) {
  const config = await fetch("/api/public-config", { cache: "no-store" }).then((response) => response.json()).catch(() => ({}));
  let accessToken = localStorage.getItem("bewlet_supabase_access_token");
  if (!accessToken || !config.supabaseUrl) accessToken = await refreshSession(config);
  let accountResponse = accessToken ? await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }) : null;
  if (accountResponse?.status === 401) {
    accessToken = await refreshSession(config);
    accountResponse = accessToken ? await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }) : null;
  }
  if (!accountResponse?.ok) location.replace("/?login=required");
  else {
    const account = await accountResponse.json();
    if (account.profile?.status !== "approved") location.replace(`/?status=${encodeURIComponent(account.profile?.status || "pending")}`);
    else {
      window.BEWLET_AUTH = { accessToken, account, config };
      window.bewletAuthFetch = async (url, options = {}) => {
        let token = window.BEWLET_AUTH.accessToken;
        let response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` } });
        if (response.status === 401) {
          token = await refreshSession(config);
          if (!token) { location.replace("/?login=required"); return response; }
          window.BEWLET_AUTH.accessToken = token;
          response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` } });
        }
        return response;
      };
    }
  }
}

if (demo || window.BEWLET_AUTH) await import("./script.js");
