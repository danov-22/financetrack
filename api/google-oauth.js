const { send, supabase, authenticatedUser, encrypt, signedState, verifyState } = require("./_lib");

module.exports = async function handler(request, response) {
  try {
    if (request.method === "POST") {
      const { user } = await authenticatedUser(request, true);
      const state = signedState({ userId: user.id, exp: Date.now() + 10 * 60 * 1000 });
      const redirectUri = `${process.env.APP_ORIGIN || "https://bewlet.vercel.app"}/api/google-oauth`;
      const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: "openid email https://www.googleapis.com/auth/drive.file", state });
      return send(response, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }
    if (request.method !== "GET") return send(response, 405, { error: "Method not allowed" });
    const state = verifyState(request.query?.state);
    if (request.query?.error) return response.redirect(302, `/app?google=error&message=${encodeURIComponent(request.query.error)}`);
    const redirectUri = `${process.env.APP_ORIGIN || "https://bewlet.vercel.app"}/api/google-oauth`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: request.query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }) });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || "Google did not return long-term permission. Try connecting again.");
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const googleUser = await userInfoResponse.json();
    await supabase("/rest/v1/google_connections?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: state.userId, encrypted_refresh_token: encrypt(tokens.refresh_token), google_email: googleUser.email || null, scope: tokens.scope || "", updated_at: new Date().toISOString() }) });
    return response.redirect(302, "/app?google=connected");
  } catch (error) {
    if (request.method === "GET") return response.redirect(302, `/app?google=error&message=${encodeURIComponent(error.message)}`);
    return send(response, error.status || 500, { error: error.message, code: error.code });
  }
};
