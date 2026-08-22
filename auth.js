const modal = document.getElementById("auth-modal");
const statusEl = document.getElementById("auth-status");
let config = null;
let pendingRegistration = null;
let paymentDetails = null;
let authMode = "login";
const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  const registering = authMode === "register";
  document.querySelector(".auth-mode-switch").classList.toggle("register", registering);
  document.getElementById("auth-mode-login").setAttribute("aria-selected", String(!registering));
  document.getElementById("auth-mode-register").setAttribute("aria-selected", String(registering));
  document.getElementById("auth-title").textContent = registering ? "Join Bewlet" : "Welcome back";
  document.getElementById("auth-message").textContent = registering ? "Create your Bewlet account with Gmail. New registrations require payment and approval." : "Sign in with the approved Gmail account connected to your Bewlet access.";
  document.getElementById("registration-region").closest("label").hidden = !registering;
  document.getElementById("payment-instructions").hidden = !registering;
  document.getElementById("payment-proof-panel").hidden = true;
  document.getElementById("auth-legal").hidden = !registering;
  document.getElementById("google-login").innerHTML = `<span>G</span>${registering ? "Register with Google" : "Sign in with Google"}`;
  setStatus("");
}

function openAuth(event) {
  setAuthMode(event?.currentTarget?.dataset?.authMode || "login");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("auth-open");
}

function closeAuth() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("auth-open");
}

async function loadConfig() {
  try {
    const response = await fetch("/api/public-config");
    config = await response.json();
    renderPaymentInstructions();
  } catch {
    config = {};
  }
}

function renderPaymentInstructions() {
  const region = document.getElementById("registration-region")?.value || "ID";
  const container = document.getElementById("payment-instructions");
  if (!container) return;
  if (!pendingRegistration) {
    const price = region === "ID" ? "Rp179,000" : "US$19";
    container.className = "payment-instructions sign-in-first";
    container.innerHTML = `<strong>Lifetime access: ${price}</strong><span>Sign in with Gmail first to securely view the payment destination and upload your proof.</span>`;
    return;
  }
  const payment = paymentDetails || {};
  if (!payment.accountNumber) {
    container.className = "payment-instructions not-ready";
    container.innerHTML = "<strong>Payment details are being prepared</strong><span>Do not transfer money until the payment account appears here. You may still sign in if you already have an approved account.</span>";
    return;
  }
  container.className = "payment-instructions";
  container.innerHTML = `<strong>${region === "ID" ? "Transfer" : "Pay"} ${escapeHtml(payment.amountLabel)} ${region === "ID" ? "to" : "using"} ${escapeHtml(payment.bankName || "the account below")}</strong><span class="account-number">${escapeHtml(payment.accountNumber)}</span><span>Account name: ${escapeHtml(payment.accountName || "Bewlet")}</span>${payment.instructions ? `<span>${escapeHtml(payment.instructions)}</span>` : ""}<span>Upload your payment screenshot below. Approval is ${escapeHtml(config.approvalTimeText)}.</span>`;
}

async function signOutLanding() {
  const token = localStorage.getItem("bewlet_supabase_access_token");
  if (token && config?.supabaseUrl) await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: "POST", headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${token}` } }).catch(() => {});
  localStorage.removeItem("bewlet_supabase_access_token");
  localStorage.removeItem("bewlet_supabase_refresh_token");
  location.replace("/");
}

function showAdminChoice() {
  document.getElementById("auth-title").textContent = "Welcome back";
  document.getElementById("auth-message").textContent = "This Gmail account has both Bewlet user and administrator access.";
  document.getElementById("registration-region").closest("label").hidden = true;
  document.getElementById("payment-instructions").hidden = true;
  document.getElementById("google-login").hidden = true;
  document.querySelector(".auth-mode-switch").hidden = true;
  document.getElementById("admin-choice-panel").hidden = false;
  setStatus("");
}

async function startGoogleLogin() {
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    setStatus("Registration setup is not connected yet. Add the Supabase environment values in Vercel.", true);
    return;
  }
  sessionStorage.setItem("bewlet_registration_region", document.getElementById("registration-region").value);
  sessionStorage.setItem("bewlet_auth_mode", authMode);
  const redirectTo = `${location.origin}/`;
  const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", redirectTo);
  location.assign(authorizeUrl.toString());
}

async function refreshLandingSession() {
  const refreshToken = localStorage.getItem("bewlet_supabase_refresh_token");
  if (!refreshToken || !config?.supabaseUrl) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  const session = await response.json();
  localStorage.setItem("bewlet_supabase_access_token", session.access_token);
  if (session.refresh_token) localStorage.setItem("bewlet_supabase_refresh_token", session.refresh_token);
  return session.access_token;
}

async function restoreRequestedSession() {
  const requested = new URLSearchParams(location.search).get("login");
  if (requested !== "required") return false;
  let accessToken = localStorage.getItem("bewlet_supabase_access_token");
  let response = accessToken ? await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }) : null;
  if (!response || response.status === 401) {
    accessToken = await refreshLandingSession();
    response = accessToken ? await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } }) : null;
  }
  if (!response?.ok) return false;
  const account = await response.json();
  if (account.admin) { openAuth(); showAdminChoice(); return true; }
  if (account.profile?.status === "approved") { location.replace("/app"); return true; }
  return false;
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
    const returningLogin = sessionStorage.getItem("bewlet_auth_mode") !== "register";
    if (!returningLogin) {
      await fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ pricing_region: region }),
      });
    }
    const profileResponse = await fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=status`, {
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
    });
    const [profile] = await profileResponse.json();
    localStorage.setItem("bewlet_supabase_access_token", accessToken);
    if (refreshToken) localStorage.setItem("bewlet_supabase_refresh_token", refreshToken);
    const accountResponse = await fetch("/api/session", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (accountResponse.ok) {
      const account = await accountResponse.json();
      if (account.admin) return showAdminChoice();
    }
    if (returningLogin && profile?.status !== "approved") {
      setAuthMode("login");
      return setStatus(`This Gmail account is ${profile?.status || "not registered"}. Use Register if this is a new account, or wait for approval if you already submitted payment.`, true);
    }
    if (profile?.status !== "approved") {
      setAuthMode("register");
      pendingRegistration = { accessToken, user, region };
      const paymentInfoResponse = await fetch("/api/payment-info", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (paymentInfoResponse.ok) {
        const paymentInfo = await paymentInfoResponse.json();
        paymentDetails = paymentInfo.payment;
        if (paymentInfo.approvalTimeText) config.approvalTimeText = paymentInfo.approvalTimeText;
      }
      renderPaymentInstructions();
      const paymentResponse = await fetch(`${config.supabaseUrl}/rest/v1/payment_submissions?user_id=eq.${encodeURIComponent(user.id)}&select=status&order=submitted_at.desc&limit=1`, { headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` } });
      const payments = paymentResponse.ok ? await paymentResponse.json() : [];
      document.getElementById("payment-proof-panel").hidden = Boolean(payments[0]?.status === "pending" || payments[0]?.status === "accepted");
      document.getElementById("google-login").hidden = true;
      document.getElementById("registration-region").closest("label").hidden = true;
      fetch("/api/account", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify-registration" }) }).catch(() => {});
    }
    if (profile?.status === "approved") location.replace("/app");
    else setStatus("Registration received. Your account is pending approval; we’ll notify you when access is ready.");
    if (profile?.status !== "approved") setStatus(`Registration received. ${document.getElementById("payment-proof-panel").hidden ? "Your payment proof is waiting for review." : "Upload your payment proof below."} Approval is ${config.approvalTimeText}. We’ll notify you when access is ready.`);
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
    const submission = await fetch(`${config.supabaseUrl}/rest/v1/payment_submissions`, { method: "POST", headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${pendingRegistration.accessToken}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ user_id: pendingRegistration.user.id, storage_path: path, amount_minor: isIndonesia ? 179000 : 1900, currency: isIndonesia ? "IDR" : "USD" }) });
    if (!submission.ok) throw new Error((await submission.json()).message || "Could not register payment proof");
    fetch("/api/account", { method: "POST", headers: { Authorization: `Bearer ${pendingRegistration.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify-payment-proof" }) }).catch(() => {});
    setStatus(`Payment proof submitted. Your registration is ready for review and is ${config.approvalTimeText}.`);
    document.getElementById("payment-proof-panel").hidden = true;
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
}

document.querySelectorAll("[data-login]").forEach((button) => button.addEventListener("click", openAuth));
document.getElementById("auth-mode-login").addEventListener("click", () => setAuthMode("login"));
document.getElementById("auth-mode-register").addEventListener("click", () => setAuthMode("register"));
document.getElementById("auth-close").addEventListener("click", closeAuth);
document.getElementById("google-login").addEventListener("click", startGoogleLogin);
document.getElementById("payment-proof-submit").addEventListener("click", submitPaymentProof);
document.getElementById("registration-region").addEventListener("change", renderPaymentInstructions);
document.getElementById("landing-sign-out").addEventListener("click", signOutLanding);
modal.addEventListener("click", (event) => { if (event.target === modal) closeAuth(); });

await loadConfig();
await handleAuthReturn();
const oauthError = new URLSearchParams(location.search).get("error_description") || new URLSearchParams(location.hash.slice(1)).get("error_description");
if (oauthError) {
  localStorage.removeItem("bewlet_supabase_access_token");
  localStorage.removeItem("bewlet_supabase_refresh_token");
  openAuth();
  setAuthMode("login");
  setStatus("Google sign-in could not be completed. The Bewlet administrator needs to verify the Google Client ID, Client Secret, and Supabase callback URL in the Supabase Google provider settings.", true);
  history.replaceState(null, "", "/");
} else await restoreRequestedSession();

const pageStatus = new URLSearchParams(location.search);
if (pageStatus.get("status")) { openAuth(); setStatus(`Your Bewlet account is ${pageStatus.get("status")}. Sign in again after its status changes.`); }
if (pageStatus.get("login") === "required") { openAuth(); setStatus("Sign in with your approved Gmail account to continue."); }
if (pageStatus.get("account") === "deleted") { openAuth(); setStatus("Your Bewlet account has been deleted."); }
