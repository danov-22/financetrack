const modal = document.getElementById("auth-modal");
const statusEl = document.getElementById("auth-status");
let config = null;
let pendingRegistration = null;

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
    if (profile?.status !== "approved") {
      pendingRegistration = { accessToken, user, region };
      document.getElementById("payment-proof-panel").hidden = false;
      fetch("/api/account", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify-registration" }) }).catch(() => {});
    }
    if (profile?.status === "approved") location.replace("/app");
    else setStatus("Registration received. Your account is pending approval; we’ll notify you when access is ready.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function submitPaymentProof() {
  const file = document.getElementById("payment-proof-file").files[0];
  if (!pendingRegistration || !file) return setStatus("Choose a payment screenshot first.", true);
  if (file.size > 5 * 1024 * 1024) return setStatus("The screenshot must be 5 MB or smaller.", true);
  const button = document.getElementById("payment-proof-submit");
  button.disabled = true; setStatus("Uploading your private payment proof…");
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${pendingRegistration.user.id}/${Date.now()}-${safeName}`;
    const upload = await fetch(`${config.supabaseUrl}/storage/v1/object/payment-proofs/${path}`, { method: "POST", headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${pendingRegistration.accessToken}`, "Content-Type": file.type, "x-upsert": "false" }, body: file });
    if (!upload.ok) throw new Error((await upload.json()).message || "Upload failed");
    const isIndonesia = pendingRegistration.region === "ID";
    const submission = await fetch(`${config.supabaseUrl}/rest/v1/payment_submissions`, { method: "POST", headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${pendingRegistration.accessToken}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ user_id: pendingRegistration.user.id, storage_path: path, amount_minor: isIndonesia ? 175000 : 1900, currency: isIndonesia ? "IDR" : "USD" }) });
    if (!submission.ok) throw new Error((await submission.json()).message || "Could not register payment proof");
    setStatus("Payment proof submitted. Your registration is ready for administrator review.");
    document.getElementById("payment-proof-panel").hidden = true;
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
}

document.querySelectorAll("[data-login]").forEach((button) => button.addEventListener("click", openAuth));
document.getElementById("auth-close").addEventListener("click", closeAuth);
document.getElementById("google-login").addEventListener("click", startGoogleLogin);
document.getElementById("payment-proof-submit").addEventListener("click", submitPaymentProof);
modal.addEventListener("click", (event) => { if (event.target === modal) closeAuth(); });

await loadConfig();
await handleAuthReturn();

const pageStatus = new URLSearchParams(location.search);
if (pageStatus.get("status")) { openAuth(); setStatus(`Your Bewlet account is ${pageStatus.get("status")}. Sign in again after its status changes.`); }
if (pageStatus.get("login") === "required") { openAuth(); setStatus("Sign in with your approved Gmail account to continue."); }
if (pageStatus.get("account") === "deleted") { openAuth(); setStatus("Your Bewlet account has been deleted."); }
