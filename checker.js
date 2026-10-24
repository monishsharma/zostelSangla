
const PROPERTY_CODE = "zostel-sangla-sngh084";
const ROOM_ID = 919;

const FIRST_DATE = "2026-12-31";
const LAST_DATE = "2027-01-03";

const BOOKING_URL =
  "https://www.zostel.com/destination/sangla/stay/" +
  `${PROPERTY_CODE}?checkin=${FIRST_DATE}&checkout=2027-01-08`;

const API_BASE = "https://api.zostel.com/api/v1/stay/offered";

function getNextDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function getDates() {
  const dates = [];
  let date = FIRST_DATE;

  while (date <= LAST_DATE) {
    dates.push(date);
    date = getNextDate(date);
  }

  return dates;
}

function formatDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  });
}

function getHeaders() {
  const token = process.env.ZOSTEL_API_TOKEN?.trim();
  const clientUserId = process.env.ZOSTEL_CLIENT_USER_ID?.trim();
  const clientAppId = process.env.ZOSTEL_CLIENT_APP_ID?.trim();

  if (!token || !clientUserId || !clientAppId) {
    throw new Error("One or more Zostel secrets are missing.");
  }

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "client-user-id": clientUserId,
    "client-app-id": clientAppId,
    Origin: "https://www.zostel.com",
    Referer: "https://www.zostel.com/"
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30000)
  });

  const body = await response.text();

  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? "Zostel authentication failed; the API token may have expired."
        : `Zostel API returned HTTP ${response.status}.`;

    throw new Error(`${message} Response: ${body.slice(0, 300)}`);
  }

  let data;

  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("Zostel API returned invalid JSON.");
  }

  return data;
}

// API 1: Determine whether this date is bookable.
async function checkBookable(date, headers) {
  const checkout = getNextDate(date);

  const params = new URLSearchParams({
    checkin: date,
    checkout,
    property_code: PROPERTY_CODE
  });

  const url = `${API_BASE}/rooms/?${params.toString()}`;
  const data = await fetchJson(url, headers);

  if (!Array.isArray(data.rooms)) {
    throw new Error("Unexpected room-status API response.");
  }

  const room = data.rooms.find(
    item => Number(item.id) === ROOM_ID
  );

  if (!room || !room.availability) {
    throw new Error(`Room ${ROOM_ID} or its availability status was missing.`);
  }

  return {
    bookable: room.availability.bookable,
    available: room.availability.available,
    units: Number(room.availability.units ?? 0)
  };
}

// API 2: Check actual inventory, but only for bookable dates.
async function checkInventory(date, headers) {
  const checkout = getNextDate(date);

  const params = new URLSearchParams({
    checkin: date,
    checkout,
    property_code: PROPERTY_CODE,
    room_ids: String(ROOM_ID)
  });

  const url = `${API_BASE}/availability/?${params.toString()}`;
  const data = await fetchJson(url, headers);

  if (!Array.isArray(data.availability)) {
    throw new Error("Unexpected inventory API response.");
  }

  const entry = data.availability.find(
    item =>
      item.date === date &&
      Number(item.room_id) === ROOM_ID
  );

  if (!entry) {
    throw new Error(`No inventory record returned for ${date}.`);
  }

  const units = Number(entry.units ?? 0);

  return {
    available: entry.available === true && units > 0,
    units,
    price: entry.price
  };
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

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
    throw new Error(
      `Telegram HTTP ${response.status}: ${
        result.description || "Unknown Telegram error"
      }`
    );
  }

  console.log("Telegram message sent successfully.");
}

async function notifyError(message) {
  try {
    await sendTelegram(message);
  } catch (error) {
    console.error("Could not send Telegram error alert:", error.message);
  }
}

async function checkDate(date, headers) {
  const label = formatDate(date);

  try {
    const status = await checkBookable(date, headers);

    if (typeof status.bookable !== "boolean") {
      throw new Error("The API did not provide a valid bookable flag.");
    }

    if (!status.bookable) {
      return `${label} — 🟡 BOOKINGS NOT OPEN / NOT BOOKABLE`;
    }

    const inventory = await checkInventory(date, headers);

    if (inventory.available) {
      const price =
        inventory.price != null ? `, ₹${inventory.price}` : "";

      return `${label} — ✅ AVAILABLE (${inventory.units} units${price})`;
    }

    return `${label} — ❌ NO ROOMS AVAILABLE`;
  } catch (error) {
    console.error(`Failed to check ${date}:`, error.message);

    await notifyError(
      "⚠️ ZOSTEL SANGLA CHECK WARNING\n\n" +
      `Date: ${label} (${date})\n` +
      `Reason: ${error.message}\n\n` +
      "This date's status could not be verified."
    );

    return `${label} — ⚠️ CHECK FAILED; STATUS UNKNOWN`;
  }
}

async function main() {
  const headers = getHeaders();
  const dates = getDates();
  const lines = [];

  for (const date of dates) {
    console.log(`Checking ${date}...`);
    lines.push(await checkDate(date, headers));
  }

  const checkedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });

  const message =
    "🏔️ ZOSTEL SANGLA — DAILY ROOM REPORT\n\n" +
    "🛏️ Room: Deluxe Room (ID 919)\n" +
    "📅 31 Dec 2026 – 3 Jan 2027\n\n" +
    lines.join("\n") +
    "\n\n🕒 Checked: " + checkedAt +
    "\n\n🔗 Booking page:\n" + BOOKING_URL;

  await sendTelegram(message);
  console.log("Daily report sent.");
}

main().catch(async error => {
  console.error("Checker failed:", error.message);

  await notifyError(
    "🚨 ZOSTEL SANGLA CHECK FAILED\n\n" +
    `Reason: ${error.message}\n\n` +
    "The daily report could not be completed."
  );

  process.exitCode = 1;
});
