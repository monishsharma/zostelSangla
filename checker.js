
const API_URL =
  "https://api.zostel.com/api/v1/stay/offered/availability/" +
  "?checkin=2026-12-31" +
  "&checkout=2027-01-08" +
  "&property_code=zostel-sangla-sngh084" +
  "&room_ids=919";

const BOOKING_URL =
  "https://www.zostel.com/destination/sangla/stay/" +
  "zostel-sangla-sngh084?checkin=2026-12-31&checkout=2027-01-08";

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Telegram secrets are missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    console.error(
      "Telegram API error:",
      result.description || response.status
    );
    throw new Error("Telegram notification failed.");
  }

  console.log("Telegram message sent.");
}

async function notifyError(message) {
  try {
    await sendTelegram(message);
  } catch (error) {
    console.error(
      "Could not send Telegram error notification:",
      error.message
    );
  }
}

async function main() {
  const token = process.env.ZOSTEL_API_TOKEN;
  const clientUserId = process.env.ZOSTEL_CLIENT_USER_ID;
  const clientAppId = process.env.ZOSTEL_CLIENT_APP_ID;

  if (!token || !clientUserId || !clientAppId) {
    throw new Error("One or more Zostel secrets are missing.");
  }

  let response;

  try {
    response = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "client-user-id": clientUserId,
        "client-app-id": clientAppId,
        Origin: "https://www.zostel.com",
        Referer: "https://www.zostel.com/"
      },
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    await notifyError(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "Could not connect to the availability API.\n" +
      `Reason: ${error.message}\n\n` +
      "Availability could not be verified."
    );

    throw error;
  }

  if (!response.ok) {
    const status = response.status;
    const errorBody = await response.text();

    console.error("Zostel API status:", status);
    console.error("Zostel API response:", errorBody);

    const reason =
      status === 401 || status === 403
        ? "🔑 Authentication failed. Your Zostel token may have expired or been invalidated."
        : `Zostel API returned HTTP ${status}.`;

    await notifyError(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      reason +
      "\n\nThe daily availability report could not be generated."
    );

    throw new Error(`Zostel API returned HTTP ${status}`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    await notifyError(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "The API returned invalid JSON. Availability could not be verified."
    );

    throw new Error("Invalid JSON from Zostel API.");
  }

  if (!Array.isArray(data.availability)) {
    await notifyError(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "Unexpected API response format. Availability could not be verified."
    );

    throw new Error("Unexpected availability response.");
  }

  // Build the eight dates we want in the daily report.
  const dates = [
    ["2026-12-31", "31 Dec"],
    ["2027-01-01", "1 Jan"],
    ["2027-01-02", "2 Jan"],
    ["2027-01-03", "3 Jan"],
    ["2027-01-04", "4 Jan"],
    ["2027-01-05", "5 Jan"],
    ["2027-01-06", "6 Jan"],
    ["2027-01-07", "7 Jan"]
  ];

  const checkedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });

  const lines = dates.map(([date, label]) => {
    const entry = data.availability.find(
      item =>
        item.date === date &&
        Number(item.room_id) === 919
    );

    if (!entry) {
      return `${label} — ⚠️ No availability data returned`;
    }

    const isAvailable =
      entry.available === true &&
      Number(entry.units) > 0;

    return isAvailable
      ? `${label} — ✅ AVAILABLE (${entry.units} units, ₹${entry.price})`
      : `${label} — ❌ NOT AVAILABLE`;
  });

  const message =
    "🏔️ ZOSTEL SANGLA — DAILY PRIVATE ROOM REPORT\n\n" +
    "🛏️ Room: Deluxe Room (ID 919)\n" +
    "📅 31 Dec 2026 – 7 Jan 2027\n\n" +
    lines.join("\n") +
    "\n\n🕒 Checked: " + checkedAt +
    "\n\n🔗 Booking page:\n" + BOOKING_URL;

  await sendTelegram(message);

  console.log("Daily availability report sent.");
}

main().catch(error => {
  console.error("Checker failed:", error.message);
  process.exitCode = 1;
});
