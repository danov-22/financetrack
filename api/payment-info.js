const { send, authenticatedUser } = require("./_lib");

module.exports = async function handler(request, response) {
  try {
    if (request.method !== "GET") return send(response, 405, { error: "Method not allowed" });
    const { profile } = await authenticatedUser(request, false);
    const indonesia = profile.pricing_region === "ID";
    const payment = indonesia
      ? { region: "ID", amountLabel: "Rp175,000", bankName: process.env.PAYMENT_ID_BANK_NAME || "", accountName: process.env.PAYMENT_ID_ACCOUNT_NAME || "", accountNumber: process.env.PAYMENT_ID_ACCOUNT_NUMBER || "", instructions: process.env.PAYMENT_ID_INSTRUCTIONS || "" }
      : { region: "INTL", amountLabel: "US$19", bankName: process.env.PAYMENT_INTL_METHOD || "", accountName: process.env.PAYMENT_INTL_ACCOUNT_NAME || "", accountNumber: process.env.PAYMENT_INTL_ACCOUNT || "", instructions: process.env.PAYMENT_INTL_INSTRUCTIONS || "" };
    return send(response, 200, { payment, approvalTimeText: process.env.APPROVAL_TIME_TEXT || "usually within 24 hours after payment proof is submitted" });
  } catch (error) {
    return send(response, error.status || 500, { error: error.message });
  }
};
