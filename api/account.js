const { send, supabase, authenticatedUser, googleAccessFor, googleFetch } = require("./_lib");

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
        try {
          const authData = await supabase("/auth/v1/admin/users?page=1&per_page=1000");
          const existing = await supabase("/rest/v1/profiles?select=id");
          const existingIds = new Set((existing || []).map((profile) => profile.id));
          const missing = (authData.users || []).filter((user) => !existingIds.has(user.id)).map((user) => { const owner = String(user.email || "").toLowerCase() === String(process.env.ADMIN_EMAIL || "").trim().toLowerCase(); return { id: user.id, email: user.email || "", display_name: user.user_metadata?.full_name || user.email || "Bewlet user", avatar_url: user.user_metadata?.avatar_url || null, status: owner ? "approved" : "pending", license_type: owner ? "lifetime" : null }; });
          if (missing.length) await supabase("/rest/v1/profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(missing) });
        } catch {}
        const profiles = await supabase("/rest/v1/profiles?select=id,email,display_name,avatar_url,status,pricing_region,license_type,created_at,approved_at,rejection_reason&order=created_at.desc");
        const payments = await supabase("/rest/v1/payment_submissions?select=id,user_id,storage_path,amount_minor,currency,status,submitted_at&order=submitted_at.desc");
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
        return send(response, 200, { profiles });
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
    if (body.action === "notify-registration") {
      if (session.profile.registration_notified_at) return send(response, 200, { notified: true });
      if (process.env.RESEND_API_KEY && process.env.APP_FROM_EMAIL && process.env.ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.APP_FROM_EMAIL, to: process.env.ADMIN_EMAIL, subject: "New Bewlet registration awaiting approval", html: `<p>${session.profile.display_name || session.profile.email} (${session.profile.email}) registered for Bewlet.</p><p>Sign in to Bewlet and open Settings → Account approvals.</p>` }) });
      }
      await supabase(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ registration_notified_at: new Date().toISOString() }) });
      return send(response, 200, { notified: true });
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
