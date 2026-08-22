const { send, authenticatedUser, supabase } = require("./_lib");

async function isAdmin(token, email) {
  const owners = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (owners.includes(String(email || "").toLowerCase())) return true;
  return Boolean(await supabase("/rest/v1/rpc/is_bewlet_admin", { method:"POST", body:"{}" }, token));
}

async function legacyAttachment(body, session) {
  if (!body.attachmentData) return "";
  const endpoint = process.env.FEEDBACK_APPS_SCRIPT_URL;
  if (!endpoint) throw new Error("Screenshot storage is not configured");
  const upstream = await fetch(endpoint, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body:JSON.stringify({ ...body, action:"saveFeedback", userId:session.user.id, userEmail:session.user.email }) });
  const text = await upstream.text();
  let result = {};
  try { result = JSON.parse(text); } catch {}
  if (!upstream.ok || !result.success) throw new Error(result.error || "Screenshot upload failed");
  return result.data?.attachmentUrl || "";
}

module.exports = async function handler(request, response) {
  try {
    const session = await authenticatedUser(request, true);
    const admin = await isAdmin(session.token, session.user.email);
    if (request.method === "GET") {
      if (request.query?.scope === "admin") {
        if (!admin) return send(response, 403, { error:"Administrator access required" });
        const tickets = await supabase("/rest/v1/feedback_tickets?select=*&order=created_at.desc");
        return send(response, 200, { success:true, data:tickets });
      }
      const tickets = await supabase(`/rest/v1/feedback_tickets?user_id=eq.${encodeURIComponent(session.user.id)}&select=*&order=created_at.desc`);
      return send(response, 200, { success:true, data:tickets.map((ticket) => ({ id:ticket.id, userId:ticket.user_id, type:ticket.type, message:ticket.message, page:ticket.page, status:ticket.status, attachmentUrl:ticket.attachment_url || "", adminReply:ticket.admin_reply || "", createdTime:ticket.created_at, withdrawnTime:ticket.status === "withdrawn" ? ticket.updated_at : "" })) });
    }
    if (request.method !== "POST") return send(response, 405, { error:"Method not allowed" });
    const body = request.body || {};
    if (body.action === "saveFeedback") {
      const attachmentUrl = await legacyAttachment(body, session);
      await supabase("/rest/v1/feedback_tickets", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ id:String(body.id), user_id:session.user.id, user_email:session.user.email || "", type:String(body.type || "Feedback").slice(0, 40), message:String(body.message || "").slice(0, 1000), page:String(body.page || "").slice(0, 40), status:"open", attachment_url:attachmentUrl || null, created_at:body.createdTime || new Date().toISOString(), updated_at:new Date().toISOString() }) });
      return send(response, 200, { success:true, data:{ attachmentUrl } });
    }
    if (body.action === "withdrawFeedback" || body.action === "deleteFeedback") {
      const path = `/rest/v1/feedback_tickets?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(session.user.id)}`;
      await supabase(path, body.action === "deleteFeedback" ? { method:"DELETE", headers:{ Prefer:"return=minimal" } } : { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ status:"withdrawn", updated_at:new Date().toISOString() }) });
      const endpoint = process.env.FEEDBACK_APPS_SCRIPT_URL;
      if (endpoint) fetch(endpoint, { method:"POST", headers:{ "Content-Type":"text/plain;charset=utf-8" }, body:JSON.stringify({ action:body.action, id:body.id, userId:session.user.id, userEmail:session.user.email }) }).catch(() => {});
      return send(response, 200, { success:true });
    }
    if (body.action === "admin-review") {
      if (!admin) return send(response, 403, { error:"Administrator access required" });
      const rows = await supabase(`/rest/v1/feedback_tickets?id=eq.${encodeURIComponent(body.id)}&select=*`);
      const ticket = rows?.[0];
      if (!ticket) return send(response, 404, { error:"Feedback ticket not found" });
      const status = ["open","reviewing","resolved"].includes(body.status) ? body.status : "reviewing";
      const reply = String(body.reply || "").trim().slice(0, 1000);
      await supabase(`/rest/v1/feedback_tickets?id=eq.${encodeURIComponent(body.id)}`, { method:"PATCH", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ status, admin_reply:reply || null, updated_at:new Date().toISOString() }) });
      if (reply) await supabase("/rest/v1/user_notifications", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ user_id:ticket.user_id, kind:"feedback", title:status === "resolved" ? "Your feedback was resolved" : "Bewlet replied to your feedback", message:reply, created_by:session.user.id }) });
      return send(response, 200, { success:true });
    }
    return send(response, 400, { error:"Unknown feedback action" });
  } catch (error) { return send(response, error.status || 500, { error:error.message }); }
};
