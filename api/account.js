const { send, supabase, authenticatedUser, googleAccessFor, googleFetch } = require("./_lib");

const emailHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]);

async function sendAdminEmail(subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.APP_FROM_EMAIL || !process.env.ADMIN_EMAIL) return false;
  const result = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.APP_FROM_EMAIL, to: String(process.env.ADMIN_EMAIL).split(",").map((email) => email.trim()).filter(Boolean), subject, html }) });
  return result.ok;
}

async function isAdmin(token, email = "") {
  const ownerEmails = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (ownerEmails.includes(String(email).trim().toLowerCase())) return true;
  return Boolean(await supabase("/rest/v1/rpc/is_bewlet_admin", { method: "POST", body: "{}" }, token));
}

async function notifyDecision(profile, decision, reason) {
  if (!process.env.RESEND_API_KEY || !process.env.APP_FROM_EMAIL) return;
  const approved = decision === "approved";
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.APP_FROM_EMAIL, to: profile.email, subject: approved ? "Your Bewlet access is approved" : "Update about your Bewlet registration", html: approved ? `<p>Your Bewlet account is approved.</p><p><a href="https://bewlet.vercel.app/">Sign in to continue</a>.</p>` : `<p>Your Bewlet registration was ${decision}.</p><p>${reason || "Contact support if you believe this is a mistake."}</p>` }) });
}

module.exports = async function handler(request, response) {
  try {
    const session = await authenticatedUser(request, false);
    if (request.method === "GET") {
      const admin = await isAdmin(session.token, session.user.email);
      if (request.query?.action === "admin-list") {
        if (!admin) return send(response, 403, { error: "Administrator access required" });
        let authUsers = [];
        const warnings = [];
        if (!process.env.RESEND_API_KEY || !process.env.APP_FROM_EMAIL || !process.env.ADMIN_EMAIL) warnings.push("Email notifications are not configured");
        try {
          const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
          const authData = await supabase("/auth/v1/admin/users?page=1&per_page=1000", { headers: { Authorization: `Bearer ${serverKey}` } });
          authUsers = authData.users || [];
          const existing = await supabase("/rest/v1/profiles?select=id");
          const existingIds = new Set((existing || []).map((profile) => profile.id));
          const missing = authUsers.filter((user) => !existingIds.has(user.id)).map((user) => { const owner = String(user.email || "").toLowerCase() === String(process.env.ADMIN_EMAIL || "").trim().toLowerCase(); return { id: user.id, email: user.email || "", display_name: user.user_metadata?.full_name || user.email || "Bewlet user", avatar_url: user.user_metadata?.avatar_url || null, status: owner ? "approved" : "pending", license_type: owner ? "lifetime" : null }; });
          if (missing.length) await supabase("/rest/v1/profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(missing) });
        } catch (error) { warnings.push(`Auth/profile setup: ${error.message}`); }
        let profiles = [];
        try { profiles = await supabase("/rest/v1/profiles?select=id,email,display_name,avatar_url,status,pricing_region,license_type,created_at,approved_at,rejection_reason&order=created_at.desc"); }
        catch (error) { warnings.push(`Profiles: ${error.message}`); }
        const profileIds = new Set(profiles.map((profile) => profile.id));
        profiles.push(...authUsers.filter((user) => !profileIds.has(user.id)).map((user) => ({ id: user.id, email: user.email || "", display_name: user.user_metadata?.full_name || user.email, status: "pending", pricing_region: "INTL", license_type: null, created_at: user.created_at })));
        const authById = new Map(authUsers.map((user) => [user.id, user]));
        profiles.forEach((profile) => { const authUser = authById.get(profile.id); profile.last_sign_in_at = authUser?.last_sign_in_at || null; });
        let payments = [];
        try { payments = await supabase("/rest/v1/payment_submissions?select=id,user_id,storage_path,amount_minor,currency,status,submitted_at&order=submitted_at.desc"); }
        catch (error) { warnings.push(`Payments: ${error.message}`); }
        const latestPayments = new Map();
        for (const payment of payments || []) {
          if (latestPayments.has(payment.user_id)) continue;
          try {
            const signed = await supabase(`/storage/v1/object/sign/payment-proofs/${payment.storage_path}`, { method: "POST", body: JSON.stringify({ expiresIn: 600 }) });
            payment.signed_url = `${process.env.SUPABASE_URL}/storage/v1${signed.signedURL}`;
          } catch {}
          latestPayments.set(payment.user_id, payment);
        }
        profiles.forEach((profile) => { profile.payment = latestPayments.get(profile.id) || null; });
        let founderSlots = [];
        try { founderSlots = await supabase("/rest/v1/founder_slots?select=region,capacity,claimed"); }
        catch (error) { warnings.push(`Founder counts: ${error.message}`); }
        return send(response, 200, { profiles, founderSlots, warnings });
      }
      const [connections, backups] = await Promise.all([
        supabase(`/rest/v1/google_connections?user_id=eq.${session.user.id}&select=google_email,connected_at`).catch(() => []),
        session.profile.status === "approved" ? supabase(`/rest/v1/data_backups?user_id=eq.${session.user.id}&select=id,byte_size,spreadsheet_revision,created_at&order=created_at.desc&limit=20`).catch(() => []) : [],
      ]);
      return send(response, 200, { user: { id: session.user.id, email: session.user.email }, profile: session.profile, admin, google: connections?.[0] || null, backups });
    }
    if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" });
    const body = request.body || {};
    if (body.action === "review") {
      if (!(await isAdmin(session.token, session.user.email))) return send(response, 403, { error: "Administrator access required" });
      const result = await supabase("/rest/v1/rpc/review_bewlet_account", { method: "POST", body: JSON.stringify({ target_user: body.userId, decision: body.decision, reason: body.reason || null }) }, session.token);
      const reviewed = Array.isArray(result) ? result[0] : result;
      const paymentStatus = body.decision === "approved" ? "accepted" : body.decision === "rejected" ? "rejected" : null;
      if (paymentStatus) {
        const pending = await supabase(`/rest/v1/payment_submissions?user_id=eq.${encodeURIComponent(body.userId)}&status=eq.pending&select=id&order=submitted_at.desc&limit=1`);
        if (pending?.[0]) await supabase(`/rest/v1/payment_submissions?id=eq.${pending[0].id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: paymentStatus, reviewed_at: new Date().toISOString(), rejection_reason: body.reason || null }) });
      }
      await notifyDecision(reviewed, body.decision, body.reason);
      return send(response, 200, { profile: reviewed });
    }
    if (body.action === "admin-delete-account") {
      if (!(await isAdmin(session.token, session.user.email))) return send(response, 403, { error: "Administrator access required" });
      const userId = String(body.userId || "");
      const profiles = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,pricing_region,license_type,google_sheet_id`);
      const target = profiles?.[0];
      if (!target) return send(response, 404, { error: "Account not found" });
      const ownerEmails = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      if (userId === session.user.id || ownerEmails.includes(String(target.email || "").toLowerCase())) return send(response, 400, { error: "The Bewlet administrator account cannot be deleted" });
      if (String(body.confirmation || "").trim().toLowerCase() !== String(target.email || "").trim().toLowerCase()) return send(response, 400, { error: "Type the account email exactly to confirm deletion" });

      const warnings = [];
      try {
        const access = await googleAccessFor(userId);
        if (target.google_sheet_id) await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.google_sheet_id)}`, access, { method: "DELETE" }).catch(() => {});
        const backups = await supabase(`/rest/v1/data_backups?user_id=eq.${encodeURIComponent(userId)}&select=drive_file_id`);
        for (const backup of backups || []) await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(backup.drive_file_id)}`, access, { method: "DELETE" }).catch(() => {});
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(access)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }).catch(() => {});
      } catch (error) { if (error.code !== "google_not_connected") warnings.push("Google Drive cleanup could not be completed"); }

      try {
        const payments = await supabase(`/rest/v1/payment_submissions?user_id=eq.${encodeURIComponent(userId)}&select=storage_path`);
        const prefixes = (payments || []).map((payment) => payment.storage_path).filter(Boolean);
        if (prefixes.length) await supabase("/storage/v1/object/payment-proofs", { method: "DELETE", body: JSON.stringify({ prefixes }) });
      } catch { warnings.push("One or more payment-proof files may still need manual removal"); }

      const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
      const deletion = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { apikey: process.env.SUPABASE_SECRET_KEY || serviceRole, Authorization: `Bearer ${serviceRole}` } });
      if (!deletion.ok) throw new Error("Account deletion could not be completed");

      if (target.license_type === "founder_lifetime" && ["ID", "INTL"].includes(target.pricing_region)) {
        try {
          const slots = await supabase(`/rest/v1/founder_slots?region=eq.${target.pricing_region}&select=claimed`);
          const claimed = Number(slots?.[0]?.claimed || 0);
          await supabase(`/rest/v1/founder_slots?region=eq.${target.pricing_region}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ claimed: Math.max(0, claimed - 1), updated_at: new Date().toISOString() }) });
        } catch { warnings.push("The founder counter could not be adjusted automatically"); }
      }
      return send(response, 200, { deleted: true, warnings });
    }
    if (body.action === "notify-registration") {
      if (session.profile.registration_notified_at) return send(response, 200, { notified: true });
      if (process.env.RESEND_API_KEY && process.env.APP_FROM_EMAIL && process.env.ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.APP_FROM_EMAIL, to: process.env.ADMIN_EMAIL, subject: "New Bewlet registration awaiting approval", html: `<p>${session.profile.display_name || session.profile.email} (${session.profile.email}) registered for Bewlet.</p><p>Sign in to Bewlet and open Settings → Account approvals.</p>` }) });
      }
      await supabase(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ registration_notified_at: new Date().toISOString() }) });
      return send(response, 200, { notified: true });
    }
    if (body.action === "notify-payment-proof") {
      const payments = await supabase(`/rest/v1/payment_submissions?user_id=eq.${encodeURIComponent(session.user.id)}&status=eq.pending&select=id,amount_minor,currency,submitted_at&order=submitted_at.desc&limit=1`);
      const payment = payments?.[0];
      if (!payment) return send(response, 404, { error: "Payment proof submission not found" });
      const amount = payment.currency === "USD" ? `US$${(Number(payment.amount_minor) / 100).toFixed(2)}` : `Rp${Number(payment.amount_minor).toLocaleString("en-US")}`;
      const adminUrl = `${String(process.env.APP_ORIGIN || "https://bewlet.vercel.app").replace(/\/$/, "")}/admin`;
      const notified = await sendAdminEmail("Bewlet payment proof ready for review", `<h2>New payment proof submitted</h2><p><strong>${emailHtml(session.profile.display_name || session.profile.email)}</strong> (${emailHtml(session.profile.email)}) has submitted a ${emailHtml(amount)} payment proof.</p><p>The image remains private. Open Bewlet Admin to review the registration and proof.</p><p><a href="${emailHtml(adminUrl)}">Open Bewlet Admin</a></p>`).catch(() => false);
      return send(response, 200, { notified });
    }
    if (body.action === "disconnect-google") {
      try { const access = await googleAccessFor(session.user.id); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(access)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch {}
      await supabase(`/rest/v1/google_connections?user_id=eq.${session.user.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return send(response, 200, { success: true });
    }
    if (body.action === "delete-account") {
      if (body.confirmation !== "DELETE MY BEWLET ACCOUNT") return send(response, 400, { error: "Confirmation phrase does not match" });
      if (!body.keepDriveFiles) {
        try {
          const access = await googleAccessFor(session.user.id);
          if (session.profile.google_sheet_id) await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(session.profile.google_sheet_id)}`, access, { method: "DELETE" });
          const backups = await supabase(`/rest/v1/data_backups?user_id=eq.${session.user.id}&select=drive_file_id`);
          for (const backup of backups || []) await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(backup.drive_file_id)}`, access, { method: "DELETE" }).catch(() => {});
        } catch {}
      }
      try { const access = await googleAccessFor(session.user.id); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(access)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch {}
      const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
      const deletion = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${session.user.id}`, { method: "DELETE", headers: { apikey: process.env.SUPABASE_SECRET_KEY || serviceRole, Authorization: `Bearer ${serviceRole}` } });
      if (!deletion.ok) throw new Error("Account deletion could not be completed");
      return send(response, 200, { deleted: true });
    }
    return send(response, 400, { error: "Unknown action" });
  } catch (error) { return send(response, error.status || 500, { error: error.message, code: error.code }); }
};
