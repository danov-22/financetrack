module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  response.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
    approvalTimeText: process.env.APPROVAL_TIME_TEXT || "usually within 24 hours after payment proof is submitted",
  });
};
