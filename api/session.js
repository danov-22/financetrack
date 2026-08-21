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
    let admin = ownerEmail(user.email);
    if (admin) return send(response, 200, { user: { id: user.id, email: user.email }, profile: { id: user.id, email: user.email, display_name: user.user_metadata?.full_name || user.email, status: "approved", license_type: "lifetime" }, admin: true });
    const profileResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
    if (!profileResponse.ok) return send(response, profileResponse.status, { error: "Could not load account profile" });
    const [profile] = await profileResponse.json();
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
