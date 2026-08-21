const { send, supabase } = require("./_lib");

function ownerEmail(email) {
  const owners = String(process.env.ADMIN_EMAIL || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return owners.includes(String(email || "").trim().toLowerCase());
}

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return send(response, 405, { error: "Method not allowed" });
    const authorization = request.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return send(response, 401, { error: "Sign in required" });
    const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return send(response, 401, { error: "Session expired" });
    const user = await userResponse.json();
    let [profile] = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
    let admin = ownerEmail(user.email);
    if (admin && profile?.status !== "approved") {
      const ownerProfile = { id: user.id, email: user.email || "", display_name: user.user_metadata?.full_name || user.email || "Bewlet Admin", avatar_url: user.user_metadata?.avatar_url || null, status: "approved", license_type: "lifetime", approved_at: new Date().toISOString() };
      await supabase("/rest/v1/profiles?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(ownerProfile) });
      [profile] = await supabase(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
    }
    if (!profile) return send(response, 403, { error: "Account profile not found" });
    if (!admin) {
      try { admin = Boolean(await supabase("/rest/v1/rpc/is_bewlet_admin", { method: "POST", body: "{}" }, token)); }
      catch { admin = false; }
    }
    return send(response, 200, { user: { id: user.id, email: user.email }, profile, admin });
  } catch (error) {
    return send(response, error.status || 500, { error: error.message, code: error.code });
  }
};
