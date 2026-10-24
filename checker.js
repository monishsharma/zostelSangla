
const { chromium } = require("playwright");


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
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram message could not be sent.");
  }
}

async function main() {
  const token = process.env.ZOSTEL_API_TOKEN;

  if (!token) {
    throw new Error("ZOSTEL_API_TOKEN secret is missing.");
  }

  const response = await fetch(API_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "HTTP_CLIENT_USER_ID": process.env.ZOSTEL_CLIENT_USER_ID,
      "HTTP_CLIENT_APP_ID": process.env.ZOSTEL_CLIENT_APP_ID
    },
    signal: AbortSignal.timeout(30000)
  });

  if (response.status === 401 || response.status === 403) {
    await sendTelegram(
      "⚠️ Zostel Sangla checker: API authentication failed. " +
      "The token may have expired or been invalidated. " +
      "Please refresh it and update ZOSTEL_API_TOKEN."
    );
    throw new Error(`Zostel API authentication failed: ${response.status}`);
  }

  if (!response.ok) {
  const errorBody = await response.text();

  console.error("Zostel API status:", response.status);
  console.error("Zostel API error body:", errorBody);

  throw new Error(`Zostel API returned HTTP ${response.status}`);
}

  const data = await response.json();

  if (!Array.isArray(data.rooms)) {
    throw new Error("Unexpected Zostel API response; availability not verified.");
  }

  const availableRooms = data.rooms.filter(room =>
    room.status === "active" &&
    room.availability?.available === true &&
    room.availability?.bookable === true &&
    Number(room.availability?.units) > 0
  );

  console.log(`Rooms checked: ${data.rooms.length}`);
  console.log(`Bookable room types: ${availableRooms.length}`);

  if (availableRooms.length > 0) {
    const roomDetails = availableRooms.map(room =>
      `• ${room.name}: ${room.availability.units} available, ₹${room.price?.final ?? "price unavailable"}`
    ).join("\n");

    await sendTelegram(
      "🎉 ZOSTEL SANGLA AVAILABILITY ALERT!\n\n" +
      "📅 31 Dec 2026 – 1 Jan 2027\n\n" +
      roomDetails +
      "\n\nBook now:\n" + BOOKING_URL
    );

    console.log("Availability alert sent.");
  } else {
    console.log("No bookable rooms found.");
  }
}

main().catch(async error => {
  console.error("Checker failed:", error.message);
  process.exitCode = 1;
});

