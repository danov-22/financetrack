const { send, authenticatedUser } = require("./_lib");

module.exports = async function handler(request, response) {
  try {
    const session = await authenticatedUser(request, true);
    const endpoint = process.env.FEEDBACK_APPS_SCRIPT_URL;
    if (!endpoint) return send(response, 503, { error: "Feedback storage is not configured" });
    if (request.method === "GET") {
      const url = new URL(endpoint);
      url.searchParams.set("action", "getFeedback");
      url.searchParams.set("userId", session.user.id);
      const upstream = await fetch(url);
      return send(response, upstream.ok ? 200 : 502, await upstream.json());
    }
    if (request.method !== "POST") return send(response, 405, { error: "Method not allowed" });
    const body = { ...(request.body || {}), userId: session.user.id, userEmail: session.user.email };
    const upstream = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    return send(response, upstream.ok ? 200 : 502, await upstream.json());
  } catch (error) { return send(response, error.status || 500, { error: error.message }); }
};
