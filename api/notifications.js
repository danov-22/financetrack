const { send, authenticatedUser, supabase } = require("./_lib");

async function isAdmin(token, email) {
  const owners = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (owners.includes(String(email || "").toLowerCase())) return true;
  return Boolean(await supabase("/rest/v1/rpc/is_bewlet_admin", { method:"POST", body:"{}" }, token));
}

module.exports = async function handler(request, response) {
  try {
    const session = await authenticatedUser(request, true);
    const admin = await isAdmin(session.token, session.user.email);
    if (request.method === "GET") {
      if (request.query?.scope === "admin") {
        if (!admin) return send(response, 403, { error:"Administrator access required" });
        return send(response, 200, { notifications:await supabase("/rest/v1/user_notifications?select=*&order=created_at.desc&limit=100") });
      }
      const now = encodeURIComponent(new Date().toISOString());
      const [items, reads] = await Promise.all([
        supabase(`/rest/v1/user_notifications?and=(or(user_id.is.null,user_id.eq.${session.user.id}),starts_at.lte.${now},or(expires_at.is.null,expires_at.gt.${now}))&select=*&order=created_at.desc&limit=100`),
        supabase(`/rest/v1/notification_reads?user_id=eq.${session.user.id}&select=notification_id`),
      ]);
      const readIds = new Set((reads || []).map((item) => item.notification_id));
      return send(response, 200, { notifications:(items || []).map((item) => ({ ...item, read:readIds.has(item.id) })) });
    }
    if (request.method !== "POST") return send(response, 405, { error:"Method not allowed" });
    const body = request.body || {};
    if (body.action === "mark-read") {
      await supabase("/rest/v1/notification_reads?on_conflict=notification_id,user_id", { method:"POST", headers:{ Prefer:"resolution=merge-duplicates,return=minimal" }, body:JSON.stringify({ notification_id:body.id, user_id:session.user.id, read_at:new Date().toISOString() }) });
      return send(response, 200, { success:true });
    }
    if (body.action === "publish") {
      if (!admin) return send(response, 403, { error:"Administrator access required" });
      const title = String(body.title || "").trim().slice(0, 120), message = String(body.message || "").trim().slice(0, 1200);
      if (!title || !message) return send(response, 400, { error:"Title and message are required" });
      await supabase("/rest/v1/user_notifications", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ user_id:null, kind:body.kind === "maintenance" ? "maintenance" : "update", title, message, starts_at:body.startsAt || new Date().toISOString(), expires_at:body.expiresAt || null, created_by:session.user.id }) });
      return send(response, 200, { success:true });
    }
    if (body.action === "delete") {
      if (!admin) return send(response, 403, { error:"Administrator access required" });
      await supabase(`/rest/v1/user_notifications?id=eq.${encodeURIComponent(body.id)}&created_by=eq.${session.user.id}`, { method:"DELETE", headers:{ Prefer:"return=minimal" } });
      return send(response, 200, { success:true });
    }
    return send(response, 400, { error:"Unknown notification action" });
  } catch (error) { return send(response, error.status || 500, { error:error.message }); }
};
