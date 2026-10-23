
const { chromium } = require("playwright");

const BOOKING_URL =
  "https://www.zostel.com/destination/sangla/stay/zostel-sangla-sngh084?checkin=2026-12-31&checkout=2027-01-01";

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Missing Telegram GitHub Secrets.");
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
    throw new Error("Telegram notification failed.");
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(BOOKING_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: document.body.innerText.slice(0, 12000)
    }));

    console.log("Page title:", pageInfo.title);
    console.log("Final URL:", pageInfo.url);
    console.log("Page text:\n", pageInfo.text);

    // Deliberately do not declare availability from page text alone.
    // We must verify Zostel's real booking/room-selection flow first.
    console.log(
      "STATUS: UNVERIFIED — inspect the booking flow before alerting."
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Availability check failed:", error.message);
  process.exitCode = 1;
});
