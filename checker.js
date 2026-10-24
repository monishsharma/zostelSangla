
const BOOKING_URL =
  "https://www.zostel.com/destination/sangla/stay/zostel-sangla-sngh084?checkin=2026-12-31&checkout=2027-01-01";

const API_URL =
  "https://api.zostel.com/api/v1/stay/offered/rooms/?checkin=2026-12-31&checkout=2027-01-01&property_code=SNGH084";

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
      headers: { "Content-Type": "application/json" },
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
    "Telegram API status:",
    response.status
  );
  console.error(
    "Telegram API response:",
    JSON.stringify(result)
  );

  throw new Error(
    `Telegram notification failed: ${
      result.description || response.status
    }`
  );
}

  console.log("Telegram notification sent.");
}

async function main() {
  const token = process.env.ZOSTEL_API_TOKEN;
  const clientUserId = process.env.ZOSTEL_CLIENT_USER_ID;
  const clientAppId = process.env.ZOSTEL_CLIENT_APP_ID;

  if (!token || !clientUserId || !clientAppId) {
    throw new Error(
      "Missing Zostel secrets. Check ZOSTEL_API_TOKEN, " +
      "ZOSTEL_CLIENT_USER_ID and ZOSTEL_CLIENT_APP_ID."
    );
  }

  let response;

  try {
    response = await fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "client-user-id": clientUserId,
        "client-app-id": clientAppId
      },
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    await sendTelegram(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "Could not connect to Zostel's API.\n" +
      "Error: " + error.message +
      "\n\nPrivate-room availability could not be verified."
    );
    throw error;
  }

  if (!response.ok) {
    const status = response.status;
    const errorBody = await response.text();

    console.error("Zostel API status:", status);
    console.error("Zostel API error:", errorBody);

    const reason =
      status === 401 || status === 403
        ? "Authentication failed. The Zostel token may have expired or been invalidated."
        : `Zostel API returned HTTP ${status}.`;

    await sendTelegram(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      reason +
      "\n\nPrivate-room availability could not be verified."
    );

    throw new Error(`Zostel API returned HTTP ${status}`);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    await sendTelegram(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "The API response was not valid JSON. " +
      "Private-room availability could not be verified."
    );
    throw new Error("Invalid JSON from Zostel API.");
  }

  if (!Array.isArray(data.rooms)) {
    await sendTelegram(
      "⚠️ ZOSTEL SANGLA CHECK FAILED\n\n" +
      "Unexpected API response format. " +
      "Private-room availability could not be verified."
    );
    throw new Error("Unexpected Zostel API response.");
  }

  const checkedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });

  // Always check private rooms only; ignore all dorm beds.
  const privateRooms = data.rooms.filter(
    room => room.sub_category === "private-room"
  );

  const availableRooms = privateRooms.filter(room =>
    room.status === "active" &&
    room.availability?.available === true &&
    room.availability?.bookable === true &&
    Number(room.availability?.units) > 0
  );

  console.log("Total room types:", data.rooms.length);
  console.log("Private room types:", privateRooms.length);
  console.log("Bookable private room types:", availableRooms.length);

  let message;

  if (availableRooms.length > 0) {
    const roomDetails = availableRooms.map(room => {
      const price = room.price?.final;
      const priceText =
        price != null ? `₹${price}` : "Price unavailable";

      return (
        `• ${room.name}\n` +
        `  Available units: ${room.availability.units}\n` +
        `  Listed price: ${priceText}`
      );
    }).join("\n\n");

    message =
      "🎉 ZOSTEL SANGLA — PRIVATE ROOM AVAILABLE!\n\n" +
      "📅 31 Dec 2026 – 1 Jan 2027\n" +
      `🕒 Checked: ${checkedAt}\n\n` +
      roomDetails +
      "\n\nBook now:\n" + BOOKING_URL;
  } else {
    message =
      "ℹ️ ZOSTEL SANGLA — DAILY UPDATE\n\n" +
      "📅 31 Dec 2026 – 1 Jan 2027\n" +
      `🕒 Checked: ${checkedAt}\n` +
      `🏠 Private room types checked: ${privateRooms.length}\n` +
      "❌ No bookable private rooms found today.\n\n" +
      "Dorm beds are excluded from this check.\n\n" +
      "Booking page:\n" + BOOKING_URL;
  }

  await sendTelegram(message);
}

main().catch(error => {
  console.error("Checker failed:", error.message);
  process.exitCode = 1;
});
