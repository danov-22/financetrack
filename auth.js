const modal = document.getElementById("auth-modal");
const statusEl = document.getElementById("auth-status");
let config = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function openAuth() {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeAuth() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function loadConfig() {
  try {
    const response = await fetch("/api/public-config");
    config = await response.json();
  } catch {
    config = {};
  }
}

async function startGoogleLogin() {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    setStatus("Registration setup is not connected yet. Add the Supabase environment values in Vercel.", true);
    return;
  }
  sessionStorage.setItem("bewlet_registration_region", document.getElementById("registration-region").value);
  const redirectTo = `${location.origin}/`;
  const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", redirectTo);
  location.assign(authorizeUrl.toString());
}

async function handleAuthReturn() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !config?.supabaseUrl) return;
  openAuth();
  setStatus("Checking your Bewlet access…");
  history.replaceState(null, "", location.pathname);
  try {
    const userResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) throw new Error("Could not verify Google sign-in");
    const user = await userResponse.json();
    const region = sessionStorage.getItem("bewlet_registration_region") || "INTL";
    await fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ pricing_region: region }),
    });
    const profileResponse = await fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=status`, {
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
    });
    const [profile] = await profileResponse.json();
    localStorage.setItem("bewlet_supabase_access_token", accessToken);
    if (refreshToken) localStorage.setItem("bewlet_supabase_refresh_token", refreshToken);
    if (profile?.status === "approved") location.replace("/app");
    else setStatus("Registration received. Your account is pending approval; we’ll notify you when access is ready.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.querySelectorAll("[data-login]").forEach((button) => button.addEventListener("click", openAuth));
document.getElementById("auth-close").addEventListener("click", closeAuth);
document.getElementById("google-login").addEventListener("click", startGoogleLogin);
modal.addEventListener("click", (event) => { if (event.target === modal) closeAuth(); });

await loadConfig();
await handleAuthReturn();
