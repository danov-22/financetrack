let config, token, profiles = [], founderSlots = [];
const statusEl = document.getElementById("admin-status");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);

async function refreshToken() {
  const refresh = localStorage.getItem("bewlet_supabase_refresh_token");
  if (!refresh) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method:"POST", headers:{ apikey:config.supabasePublishableKey, "Content-Type":"application/json" }, body:JSON.stringify({ refresh_token:refresh }) });
  if (!response.ok) return null;
  const session = await response.json();
  localStorage.setItem("bewlet_supabase_access_token", session.access_token);
  if (session.refresh_token) localStorage.setItem("bewlet_supabase_refresh_token", session.refresh_token);
  return session.access_token;
}

async function api(path = "", options = {}) {
  const request = () => fetch(`/api/account${path}`, { ...options, headers:{ "Content-Type":"application/json", ...(options.headers || {}), Authorization:`Bearer ${token}` } });
  let response = await request();
  if (response.status === 401) { token = await refreshToken(); if (!token) return location.replace("/?login=required"); response = await request(); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Admin request failed");
  return data;
}

const paymentAmount = (payment) => payment.currency === "USD" ? `US$${(Number(payment.amount_minor) / 100).toFixed(2)}` : `Rp${Number(payment.amount_minor).toLocaleString()}`;
const isActive = (profile) => Boolean(profile.last_sign_in_at && Date.now() - new Date(profile.last_sign_in_at).getTime() <= 30 * 86400000);

function render() {
  const filter = document.getElementById("admin-filter").value;
  const search = document.getElementById("admin-search").value.trim().toLowerCase();
  const matches = (profile) => filter === "all" || (filter === "active" ? profile.status === "approved" && isActive(profile) : ["ID","INTL"].includes(filter) ? profile.pricing_region === filter : profile.status === filter);
  const visible = profiles.filter((profile) => matches(profile) && (!search || `${profile.display_name || ""} ${profile.email}`.toLowerCase().includes(search)));
  document.getElementById("pending-count").textContent = profiles.filter((profile) => profile.status === "pending").length;
  document.getElementById("approved-count").textContent = profiles.filter((profile) => profile.status === "approved").length;
  document.getElementById("active-count").textContent = profiles.filter((profile) => profile.status === "approved" && isActive(profile)).length;
  const idSlot = founderSlots.find((slot) => slot.region === "ID"), intlSlot = founderSlots.find((slot) => slot.region === "INTL");
  document.getElementById("id-founder-count").textContent = `${idSlot?.claimed || 0}/${idSlot?.capacity || 100}`;
  document.getElementById("intl-founder-count").textContent = `${intlSlot?.claimed || 0}/${intlSlot?.capacity || 100}`;
  document.getElementById("admin-list").innerHTML = visible.length ? visible.map((profile) => `<article class="account-row"><div><h3>${escapeHtml(profile.display_name || profile.email)}</h3><div class="account-meta"><span>${escapeHtml(profile.email)}</span><span class="badge">${escapeHtml(profile.status)}</span><span>${escapeHtml(profile.pricing_region)}</span><span>Registered ${new Date(profile.created_at).toLocaleDateString()}</span>${profile.last_sign_in_at ? `<span>Last active ${new Date(profile.last_sign_in_at).toLocaleDateString()}</span>` : ""}</div>${profile.payment?.signed_url ? `<a class="proof" href="${escapeHtml(profile.payment.signed_url)}" target="_blank" rel="noopener">View payment proof · ${paymentAmount(profile.payment)}</a>` : '<div class="proof">No payment proof submitted</div>'}</div><div class="account-actions">${profile.status === "pending" ? `<button class="approve" onclick="review('${profile.id}','approved')">Approve</button><button class="reject" onclick="review('${profile.id}','rejected')">Reject</button>` : ""}${profile.status === "approved" ? `<button class="suspend" onclick="review('${profile.id}','suspended')">Suspend</button>` : ""}${["rejected","suspended"].includes(profile.status) ? `<button class="restore" onclick="review('${profile.id}','approved')">Restore access</button>` : ""}<button class="delete-account" onclick="deleteAndReset('${profile.id}','${escapeHtml(profile.email)}')">Delete &amp; reset</button></div></article>`).join("") : '<div class="empty">No accounts match this view.</div>';
}

async function load() {
  statusEl.textContent = "Loading accounts…";
  try { const data = await api("?action=admin-list"); profiles = data.profiles || []; founderSlots = data.founderSlots || []; const supportInput = document.getElementById("support-whatsapp"); if (supportInput && document.activeElement !== supportInput) supportInput.value = data.supportWhatsApp || ""; render(); statusEl.textContent = `${profiles.length} total account${profiles.length === 1 ? "" : "s"}${data.warnings?.length ? ` · Setup warning: ${data.warnings.join(" | ")}` : ""}`; }
  catch (error) { statusEl.textContent = error.message; }
}

window.review = async (userId, decision) => {
  const reason = ["rejected","suspended"].includes(decision) ? prompt(`Reason for ${decision}:`) || `Account ${decision}` : "";
  if (!confirm(`${decision.charAt(0).toUpperCase() + decision.slice(1)} this account?`)) return;
  try { const result = await api("", { method:"POST", body:JSON.stringify({ action:"review", userId, decision, reason }) }); await load(); statusEl.textContent = result.notification?.sent ? `Account ${decision}. Email notification sent successfully.` : `Account ${decision}, but email was not delivered: ${result.notification?.error || "unknown email error"}`; } catch (error) { statusEl.textContent = error.message; }
};

window.deleteAndReset = async (userId, email) => {
  const confirmation = prompt(`Permanently delete ${email}?\n\nThis removes their login, Bewlet records, payment proof, Google connection, and Bewlet-created Drive data. They can register again afterward.\n\nType the email address to confirm:`);
  if (confirmation === null) return;
  if (confirmation.trim().toLowerCase() !== email.trim().toLowerCase()) { statusEl.textContent = "Deletion cancelled: the email did not match."; return; }
  if (!confirm("This cannot be undone. Delete and reset this account now?")) return;
  statusEl.textContent = `Deleting ${email}…`;
  try { const result = await api("", { method:"POST", body:JSON.stringify({ action:"admin-delete-account", userId, confirmation }) }); await load(); statusEl.textContent = result.warnings?.length ? `Account deleted · ${result.warnings.join(" · ")}` : "Account deleted and reset. The user can register again."; }
  catch (error) { statusEl.textContent = error.message; }
};

document.getElementById("admin-search").addEventListener("input", render);
document.getElementById("admin-filter").addEventListener("change", render);
document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => { document.getElementById("admin-filter").value = button.dataset.adminView; render(); }));
document.getElementById("admin-refresh").addEventListener("click", load);
document.getElementById("admin-signout").addEventListener("click", async () => { if (token) await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method:"POST", headers:{ apikey:config.supabasePublishableKey, Authorization:`Bearer ${token}` } }).catch(() => {}); localStorage.removeItem("bewlet_supabase_access_token"); localStorage.removeItem("bewlet_supabase_refresh_token"); location.replace("/"); });

let feedbackTickets = [], announcements = [];
async function betaApi(url, options = {}) { const response = await fetch(url, { ...options, headers:{ "Content-Type":"application/json", ...(options.headers || {}), Authorization:`Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Beta admin request failed"); return data; }
const feedbackReplyTemplates = {
  acknowledge: "Thank you for sending this. We’ve read your feedback and will discuss it with the Bewlet team. We’ll share an update here when there is progress.",
  details: "Thank you for reporting this. We’re reviewing it, but we need a little more information. Please send the steps you followed, what you expected to happen, and what happened instead.",
  planned: "Thank you for the suggestion. We’ve reviewed it and added it to our list of improvements for consideration. We’ll notify users if it is included in a future Bewlet update.",
  resolved: "Thank you for helping us improve Bewlet. We’ve reviewed this report and marked it as resolved. Please try again and send another report if the issue continues.",
};
function renderFeedbackTickets() { const filter = document.getElementById("feedback-admin-status").value; const visible = feedbackTickets.filter((ticket) => filter === "all" || (filter === "active" ? ["open","reviewing"].includes(ticket.status) : ticket.status === filter)); document.getElementById("admin-feedback-list").innerHTML = visible.length ? visible.map((ticket) => `<article class="feedback-ticket ${escapeHtml(ticket.status)}"><div class="ticket-head"><strong>${escapeHtml(ticket.type)}</strong><span>${ticket.status === "resolved" ? "✓" : ticket.status === "reviewing" ? "◐" : "○"} ${escapeHtml(ticket.status)}</span></div><p>${escapeHtml(ticket.message)}</p><div class="ticket-meta">${escapeHtml(ticket.user_email)} · ${escapeHtml(ticket.page || "Unknown page")} · ${new Date(ticket.created_at).toLocaleString()}</div>${ticket.attachment_url ? `<a class="proof" href="${escapeHtml(ticket.attachment_url)}" target="_blank" rel="noopener">View screenshot</a>` : ""}<div class="ticket-templates"><span>Quick reply</span><button onclick="useFeedbackTemplate('${escapeHtml(ticket.id)}','acknowledge')">Received</button><button onclick="useFeedbackTemplate('${escapeHtml(ticket.id)}','details')">Need details</button><button onclick="useFeedbackTemplate('${escapeHtml(ticket.id)}','planned')">Consider for update</button><button onclick="useFeedbackTemplate('${escapeHtml(ticket.id)}','resolved')">Resolved</button></div><textarea id="reply-${escapeHtml(ticket.id)}" class="ticket-reply" maxlength="1000" placeholder="Choose a template or write a custom reply…">${escapeHtml(ticket.admin_reply || "")}</textarea><div class="ticket-actions"><button class="reviewing" onclick="reviewFeedback('${escapeHtml(ticket.id)}','reviewing')">◐ Acknowledge &amp; review</button><button class="resolved" onclick="reviewFeedback('${escapeHtml(ticket.id)}','resolved')">✓ Resolve &amp; reply</button></div></article>`).join("") : '<div class="beta-empty">No feedback matches this checklist.</div>'; }
function renderAnnouncements() { document.getElementById("admin-announcement-list").innerHTML = announcements.length ? announcements.map((item) => `<article class="announcement-item"><div class="announcement-head"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.kind)}</span></div><p>${escapeHtml(item.message)}</p><div class="announcement-head"><span>${new Date(item.starts_at).toLocaleString()}</span><button onclick="deleteAnnouncement('${item.id}')">Delete</button></div></article>`).join("") : '<div class="beta-empty">No announcements published yet.</div>'; }
async function loadBeta() { try { const [feedback, notices] = await Promise.all([betaApi("/api/feedback?scope=admin"), betaApi("/api/notifications?scope=admin")]); feedbackTickets = feedback.data || []; announcements = notices.notifications || []; renderFeedbackTickets(); renderAnnouncements(); } catch (error) { document.getElementById("admin-feedback-list").innerHTML = `<div class="beta-empty">${escapeHtml(error.message)}. Run the beta notification SQL migration if setup is incomplete.</div>`; } }
window.useFeedbackTemplate = (id, template) => { const input = document.getElementById(`reply-${id}`); if (!input || !feedbackReplyTemplates[template]) return; input.value = feedbackReplyTemplates[template]; input.focus(); };
window.reviewFeedback = async (id, status) => { const input = document.getElementById(`reply-${id}`); let reply = input?.value.trim() || ""; if (!reply) reply = status === "resolved" ? feedbackReplyTemplates.resolved : feedbackReplyTemplates.acknowledge; if (input) input.value = reply; const action = status === "resolved" ? "resolve this feedback and notify the sender" : "mark this as reviewing and notify the sender"; if (!confirm(`Confirm: ${action}?`)) return; try { await betaApi("/api/feedback", { method:"POST", body:JSON.stringify({ action:"admin-review", id, status, reply }) }); await loadBeta(); statusEl.textContent = status === "resolved" ? "Feedback resolved and the sender was notified." : "Feedback acknowledged. The sender was notified that it is under review."; } catch (error) { statusEl.textContent = error.message; } };
window.deleteAnnouncement = async (id) => { if (!confirm("Delete this announcement from every user’s inbox?")) return; try { await betaApi("/api/notifications", { method:"POST", body:JSON.stringify({ action:"delete", id }) }); await loadBeta(); } catch (error) { document.getElementById("announcement-status").textContent = error.message; } };
document.getElementById("feedback-admin-status").addEventListener("change", renderFeedbackTickets);
document.getElementById("feedback-refresh").addEventListener("click", loadBeta);
document.getElementById("announcement-form").addEventListener("submit", async (event) => { event.preventDefault(); const starts = document.getElementById("announcement-start").value, expires = document.getElementById("announcement-expiry").value; try { await betaApi("/api/notifications", { method:"POST", body:JSON.stringify({ action:"publish", kind:document.getElementById("announcement-kind").value, title:document.getElementById("announcement-title").value, message:document.getElementById("announcement-message").value, startsAt:starts ? new Date(starts).toISOString() : "", expiresAt:expires ? new Date(expires).toISOString() : "" }) }); event.target.reset(); document.getElementById("announcement-status").textContent = "Announcement published to users."; await loadBeta(); } catch (error) { document.getElementById("announcement-status").textContent = error.message; } });
document.getElementById("support-whatsapp-form").addEventListener("submit", async (event) => { event.preventDefault(); const status = document.getElementById("support-whatsapp-status"); status.textContent = "Saving…"; try { const result = await api("", { method:"POST", body:JSON.stringify({ action:"update-support-whatsapp", value:document.getElementById("support-whatsapp").value }) }); document.getElementById("support-whatsapp").value = result.supportWhatsApp; status.textContent = "WhatsApp support number saved for all users."; } catch (error) { status.textContent = error.message; } });

config = await fetch("/api/public-config", { cache:"no-store" }).then((response) => response.json());
token = localStorage.getItem("bewlet_supabase_access_token") || await refreshToken();
if (!token) location.replace("/?login=required");
else { const sessionResponse = await fetch("/api/session", { headers:{ Authorization:`Bearer ${token}` } }); const session = sessionResponse.ok ? await sessionResponse.json() : null; if (!sessionResponse.ok) location.replace("/?login=required"); else if (!session.admin) location.replace("/app"); else { load(); loadBeta(); } }
